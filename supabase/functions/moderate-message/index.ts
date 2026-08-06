// =====================================================================
// moderate-message — the AI stage of the chat pipeline
//
// Phase 1 runs on database rules alone and does not need this deployed. This
// exists so the AI check can be switched on without changing anything else:
// the client keeps calling one thing, and the rules keep living in mod_rules.
//
// The order is the order that was asked for, and it matters:
//
//   1. rules      cheap, deterministic, and catches most of it
//   2. AI         only for what survived, so the bill is small
//   3. store      only if both passed
//
// It is the service_role key that makes this enforceable. With
// mod_settings.require_ai = true, chat_send() refuses every caller that is not
// service_role, so the browser cannot reach the table at all and this function
// becomes the only way a message can be stored.
//
// Deploy:
//   supabase functions deploy moderate-message
//   supabase secrets set OPENAI_API_KEY=sk-...
//   -- then, in SQL:  update public.mod_settings set require_ai = true;
//
// The provider below is OpenAI's moderation endpoint because it is free and
// purpose-built. Swapping it is one function: return {flagged, reason}.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS, "Content-Type": "application/json" },
	})
}

// The categories worth blocking outright. "flagged" on its own is broader than
// this chat needs to care about, so the decision is made on the specific ones
// rather than the summary flag.
const BLOCK_CATEGORIES = [
	"sexual", "sexual/minors",
	"harassment", "harassment/threatening",
	"hate", "hate/threatening",
	"violence", "violence/graphic",
	"self-harm", "self-harm/intent", "self-harm/instructions",
]

async function aiVerdict(text: string): Promise<{ blocked: boolean; reason: string | null }> {
	const key = Deno.env.get("OPENAI_API_KEY")
	// Not configured: say so rather than silently passing everything. The
	// caller decides whether that is fatal; with require_ai on, it is.
	if (!key) return { blocked: false, reason: "ai-unconfigured" }

	const res = await fetch("https://api.openai.com/v1/moderations", {
		method: "POST",
		headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
		body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
	})
	if (!res.ok) return { blocked: false, reason: "ai-unavailable" }

	const data = await res.json()
	const r = data?.results?.[0]
	if (!r) return { blocked: false, reason: "ai-unavailable" }

	for (const c of BLOCK_CATEGORIES) {
		if (r.categories?.[c]) return { blocked: true, reason: c }
	}
	return { blocked: false, reason: null }
}

Deno.serve(async (req: Request) => {
	if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
	if (req.method !== "POST") return json({ error: "POST only" }, 405)

	const url = Deno.env.get("SUPABASE_URL")!
	const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
	const auth = req.headers.get("Authorization") ?? ""

	// Who is asking, established from their own token rather than from anything
	// in the body. The body cannot claim to be someone else.
	const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
		global: { headers: { Authorization: auth } },
	})
	const { data: userData } = await asUser.auth.getUser()
	const me = userData?.user
	if (!me) return json({ error: "Not signed in" }, 401)

	let target = "", body = ""
	try {
		const payload = await req.json()
		target = String(payload.target ?? "")
		body = String(payload.body ?? "")
	} catch {
		return json({ error: "Bad request" }, 400)
	}
	if (!target || !body.trim()) return json({ error: "Nothing to send" }, 400)
	if (body.length > 500) return json({ error: "Too long — 500 characters at most" }, 400)

	const admin = createClient(url, serviceKey)

	// 1. rules. Same function the database would run on its own, called here so
	// a rule rejection never costs an AI call.
	const { data: checked, error: checkErr } = await admin.rpc("mod_check", { body })
	if (checkErr) return json({ error: "Moderation is unavailable" }, 503)
	const verdict = Array.isArray(checked) ? checked[0] : checked
	if (verdict && verdict.ok === false) {
		await admin.from("moderation_events").insert({
			user_id: me.id, category: verdict.category, reason: verdict.note,
			action: "rejected", length: body.length,
		})
		return json({ error: `Message not sent — ${verdict.note ?? "it broke a chat rule"}` }, 422)
	}

	// 2. AI, on what is left
	const ai = await aiVerdict(body)
	if (ai.reason === "ai-unconfigured" || ai.reason === "ai-unavailable") {
		// Fail closed. require_ai is on, which is a statement that messages are
		// not to be stored unchecked; letting them through when the checker is
		// down would quietly undo that at exactly the wrong moment.
		await admin.from("moderation_events").insert({
			user_id: me.id, category: "system", reason: ai.reason,
			action: "deferred", length: body.length,
		})
		return json({ error: "Moderation is unavailable — try again shortly" }, 503)
	}
	if (ai.blocked) {
		await admin.from("moderation_events").insert({
			user_id: me.id, category: "ai", reason: ai.reason,
			action: "rejected", length: body.length,
		})
		return json({ error: "Message not sent — it broke a chat rule" }, 422)
	}

	// 3. store, as service_role, which is the only caller chat_send accepts
	// while require_ai is on. Impersonating the sender is done by passing their
	// id, not their token: the function is running with full rights, so the
	// sender has to be stated rather than inferred.
	const { data: sent, error: sendErr } = await admin.rpc("chat_send_as", {
		sender: me.id, target, body,
	})
	if (sendErr) return json({ error: sendErr.message }, 400)

	return json({ ok: true, message: Array.isArray(sent) ? sent[0] : sent })
})

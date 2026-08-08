// =====================================================================
// create-portal-session — cancel, change card, download invoices
//
// Deploy:
//   supabase functions deploy create-portal-session
//   (uses STRIPE_SECRET_KEY and SITE_ORIGINS, already set for checkout)
//
// Cancellation is Stripe's Billing Portal rather than a button of our own,
// for three reasons: the card and invoices live there anyway, the portal is
// already localised and accessible, and a cancel flow we write ourselves is
// one more place a bug could take someone's money after they asked us to
// stop. Stripe sends customer.subscription.updated with
// cancel_at_period_end = true, and the webhook records it; access continues
// until the period end, which is what they paid for.
//
// The customer id comes from OUR table keyed by the caller's own JWT — never
// from the request body. Accepting a customer id from the browser would let
// anyone open anyone else's billing portal, which shows their invoices and
// lets them cancel the subscription.
// =====================================================================

import Stripe from "npm:stripe@^17.0.0"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED = (Deno.env.get("SITE_ORIGINS") ?? "https://cyphers.news")
	.split(",").map((s) => s.trim()).filter(Boolean)

// An allow-list rather than "*". A Bearer-token API is not exploitable through
// a wildcard on its own — the token is a header, not a cookie, so a hostile
// page has nothing to replay. But an allow-list costs nothing, and when
// Matching moves to its own origin this is already the place that decides
// which origins are ours.
function corsFor(req: Request): Record<string, string> {
	const origin = req.headers.get("Origin") ?? ""
	return {
		"Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0],
		"Vary": "Origin",
		"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
	}
}

// Bound per request so the reply carries the caller's own origin.
function jsonFor(req: Request) {
	const cors = corsFor(req)
	return (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { ...cors, "Content-Type": "application/json" },
		})
}

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
	httpClient: Stripe.createFetchHttpClient(),
	apiVersion: "2025-06-30.basil",
})

const RETURN_ORIGINS = (Deno.env.get("SITE_ORIGINS") ?? "https://cyphers.news")
	.split(",").map((s) => s.trim()).filter(Boolean)

Deno.serve(async (req: Request) => {
	const json = jsonFor(req)
	if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) })
	if (req.method !== "POST") return json({ error: "POST only" }, 405)

	const url = Deno.env.get("SUPABASE_URL")!

	const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
		global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
	})
	const { data: userData } = await asUser.auth.getUser()
	const me = userData?.user
	if (!me) return json({ error: "Sign in first" }, 401)

	let origin: string | null = null
	try {
		const payload = await req.json().catch(() => ({}))
		origin = typeof payload.origin === "string" ? payload.origin : null
	} catch { /* optional */ }
	const back = (origin && RETURN_ORIGINS.includes(origin)) ? origin : RETURN_ORIGINS[0]

	const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
	const { data: row } = await admin
		.from("subscriptions")
		.select("provider_customer_id")
		.eq("user_id", me.id)
		.maybeSingle()

	if (!row?.provider_customer_id) {
		return json({ error: "You have never subscribed, so there is nothing to manage" }, 404)
	}

	const session = await stripe.billingPortal.sessions.create({
		customer: row.provider_customer_id,
		return_url: `${back}/match.html`,
	})

	return json({ url: session.url })
})

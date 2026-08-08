// =====================================================================
// create-checkout-session — starts a Matching Access subscription
//
// Deploy:
//   supabase functions deploy create-checkout-session
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_PRICE_ID=price_...        (Matching Access, monthly)
//
// This function never sees a card. It creates a Stripe Checkout Session and
// returns its URL; the browser redirects there, and Stripe collects the card
// on its own domain under its own PCI scope. Nothing about the payment
// instrument passes through this code or through cyphers.news.
//
// WHO THE MEMBER IS COMES FROM THEIR OWN TOKEN
//
// The body is never trusted for identity. If it were, anyone could post
// someone else's user id and link their own Stripe customer to that account.
// The user is read from the Authorization header via auth.getUser(), the same
// way moderate-message does it.
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

// Where Stripe sends the member back. Taken from an allow-list rather than
// from the request body: an open redirect on the success URL would let anyone
// bounce a Stripe-branded flow into a page of their choosing.
const RETURN_ORIGINS = (Deno.env.get("SITE_ORIGINS") ?? "https://cyphers.news")
	.split(",").map((s) => s.trim()).filter(Boolean)

function safeOrigin(requested: string | null): string {
	if (requested && RETURN_ORIGINS.includes(requested)) return requested
	return RETURN_ORIGINS[0]
}

Deno.serve(async (req: Request) => {
	const json = jsonFor(req)
	if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) })
	if (req.method !== "POST") return json({ error: "POST only" }, 405)

	const url = Deno.env.get("SUPABASE_URL")!
	const priceId = Deno.env.get("STRIPE_PRICE_ID")
	if (!priceId) return json({ error: "Subscriptions are not configured yet" }, 503)

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
	} catch { /* body is optional */ }
	const back = safeOrigin(origin)

	const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

	// Reuse the member's existing Stripe customer if they have one. Creating a
	// second customer for the same person splits their billing history and
	// makes the webhook's customer lookup ambiguous.
	const { data: existing } = await admin
		.from("subscriptions")
		.select("provider_customer_id, status")
		.eq("user_id", me.id)
		.maybeSingle()

	// Already paying: don't take a second subscription. Send them to the
	// portal instead - Stripe will happily create a duplicate if asked.
	if (existing && ["active", "trialing"].includes(existing.status ?? "")) {
		return json({ error: "You already have an active subscription", already: true }, 409)
	}

	let customerId: string | null = existing?.provider_customer_id ?? null

	if (!customerId) {
		const customer = await stripe.customers.create({
			email: me.email ?? undefined,
			// The link back to us. Kept in metadata as a cross-check only —
			// the webhook resolves the member through subscriptions, never
			// through metadata, because metadata is editable in the dashboard.
			metadata: { supabase_user_id: me.id },
		})
		customerId = customer.id
	}

	// Link BEFORE the redirect. If checkout.session.completed arrives while
	// this row does not exist, the webhook has no way to attribute it and the
	// member pays without being unlocked.
	const { error: linkErr } = await admin.rpc("billing_link_customer", {
		target: me.id,
		customer_id: customerId,
	})
	if (linkErr) {
		console.error("billing_link_customer failed:", linkErr.message)
		return json({ error: "Could not start checkout" }, 500)
	}

	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		customer: customerId,
		line_items: [{ price: priceId, quantity: 1 }],
		success_url: `${back}/match.html?checkout=success`,
		cancel_url: `${back}/match.html?checkout=cancelled`,
		allow_promotion_codes: true,
		// UK-based: Stripe Tax works out VAT from the billing address it
		// collects. We never see or store that address.
		automatic_tax: { enabled: true },
		billing_address_collection: "auto",
		subscription_data: { metadata: { supabase_user_id: me.id } },
		client_reference_id: me.id,
	})

	return json({ url: session.url })
})

// =====================================================================
// stripe-webhook — the only writer of public.subscriptions
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//
// --no-verify-jwt IS REQUIRED AND IS NOT A HOLE. Stripe has no Supabase JWT to
// send; it authenticates by signing the raw request body with the endpoint's
// own secret. Turning JWT verification on would reject every real webhook and
// let none through — the signature check below is the authentication, and it
// runs before anything is read out of the payload.
//
// Events to select in the Stripe dashboard (Developers -> Webhooks):
//   checkout.session.completed
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_failed
//
// GRANT AND REVOKE, WHICH IS THE WHOLE POINT
//
//   grant  -> customer.subscription.created / updated with status active
//   revoke -> deleted, or updated with a status that is not active/trialing
//
// Revocation has a second, independent mechanism: subscription_active() also
// checks current_period_end. If this function never runs again, every paying
// member's access lapses at their period end rather than lasting forever. A
// webhook outage costs us prompt revocation, not eventual revocation.
// =====================================================================

import Stripe from "npm:stripe@^17.0.0"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
	// Deno has no Node crypto, so the fetch-based HTTP client is required
	httpClient: Stripe.createFetchHttpClient(),
	apiVersion: "2025-06-30.basil",
})

// Stripe statuses are not our statuses. Ours are the set the check constraint
// on public.subscriptions allows, and the mapping is deliberately narrow:
// anything unrecognised becomes 'none', which locks Matching. Failing closed
// on an unknown status is the right default for a paywall.
function mapStatus(stripeStatus: string): string {
	switch (stripeStatus) {
		case "active":              return "active"
		case "trialing":            return "trialing"
		case "past_due":            return "past_due"
		case "paused":              return "paused"
		case "canceled":            return "canceled"
		case "unpaid":              return "canceled"
		case "incomplete_expired":  return "canceled"
		case "incomplete":          return "none"
		default:                    return "none"
	}
}

function seconds(v: number | null | undefined): string | null {
	return (typeof v === "number" && isFinite(v)) ? new Date(v * 1000).toISOString() : null
}

Deno.serve(async (req: Request) => {
	if (req.method !== "POST") return new Response("POST only", { status: 405 })

	const signature = req.headers.get("stripe-signature")
	const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET")
	if (!signature || !secret) return new Response("Not configured", { status: 500 })

	// The RAW body, before any parsing. Stripe signs the exact bytes, so
	// req.json() here would change them and every signature would fail.
	const raw = await req.text()

	let event: Stripe.Event
	try {
		// constructEventAsync, not constructEvent: Deno's crypto is async-only
		event = await stripe.webhooks.constructEventAsync(raw, signature, secret)
	} catch (err) {
		// A bad signature is either a misconfiguration or someone forging
		// webhooks to grant themselves a subscription. Either way: 400, and
		// nothing is read out of the body.
		console.error("signature verification failed:", (err as Error).message)
		return new Response("Bad signature", { status: 400 })
	}

	const url = Deno.env.get("SUPABASE_URL")!
	const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

	// Every branch below fills these in and then hands them to one SQL
	// function, so the idempotency and ordering rules cannot be forgotten in
	// one branch and remembered in another.
	let customerId: string | null = null
	let subId: string | null = null
	let status = "none"
	let periodEnd: string | null = null
	let cancelAtEnd = false
	let priceId: string | null = null

	switch (event.type) {
		case "checkout.session.completed": {
			const s = event.data.object as Stripe.Checkout.Session
			// Only subscription-mode sessions matter here; a one-off payment
			// would need different handling and we do not sell one.
			if (s.mode !== "subscription") return new Response("ignored", { status: 200 })
			customerId = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null
			subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null

			// The session itself carries no period end. Fetch the subscription
			// rather than guessing one - a guessed period end is either a free
			// month or an early lockout.
			if (subId) {
				const sub = await stripe.subscriptions.retrieve(subId)
				status = mapStatus(sub.status)
				periodEnd = seconds((sub as unknown as { current_period_end?: number }).current_period_end)
				cancelAtEnd = !!sub.cancel_at_period_end
				priceId = sub.items?.data?.[0]?.price?.id ?? null
			}
			break
		}

		case "customer.subscription.created":
		case "customer.subscription.updated":
		case "customer.subscription.deleted": {
			const sub = event.data.object as Stripe.Subscription
			customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null
			subId = sub.id
			// A deletion is terminal regardless of what status field it carries
			status = event.type === "customer.subscription.deleted"
				? "canceled"
				: mapStatus(sub.status)
			periodEnd = seconds((sub as unknown as { current_period_end?: number }).current_period_end)
			cancelAtEnd = !!sub.cancel_at_period_end
			priceId = sub.items?.data?.[0]?.price?.id ?? null
			break
		}

		case "invoice.payment_failed": {
			const inv = event.data.object as Stripe.Invoice
			customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null
			const s = (inv as unknown as { subscription?: string | { id: string } }).subscription
			subId = typeof s === "string" ? s : s?.id ?? null
			// past_due is not in subscription_active()'s allow-list, so this
			// locks Matching immediately. Stripe keeps retrying the card; a
			// successful retry sends an `updated` that unlocks it again.
			status = "past_due"
			// Deliberately keep whatever period end is already stored - a failed
			// payment does not change when the paid-for period ends
			periodEnd = null
			break
		}

		default:
			// Acknowledge, don't retry. An unhandled type is not a failure.
			return new Response("ignored", { status: 200 })
	}

	if (!customerId) {
		console.error("no customer on event", event.id, event.type)
		return new Response("ok", { status: 200 })
	}

	const { data, error } = await admin.rpc("billing_apply_event", {
		event_id: event.id,
		event_type: event.type,
		event_at: new Date(event.created * 1000).toISOString(),
		customer_id: customerId,
		sub_id: subId,
		new_status: status,
		period_end: periodEnd,
		cancel_at_end: cancelAtEnd,
		price_id: priceId,
	})

	if (error) {
		// A real failure: 500 so Stripe retries. The idempotency key means the
		// retry is safe even if we half-applied.
		console.error("billing_apply_event failed:", error.message)
		return new Response("apply failed", { status: 500 })
	}

	// data === false means duplicate or stale. That is a success from Stripe's
	// point of view; returning anything but 2xx would make it retry forever.
	return new Response(JSON.stringify({ applied: data === true }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	})
})

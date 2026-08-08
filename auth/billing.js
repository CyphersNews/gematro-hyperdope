// ======================= Subscription state =======================
//
// Reads the member's own subscription and nothing else. There is no function
// here that starts, changes or cancels one, because none of that can happen in
// a browser: the payment provider owns the card, and the provider's webhook -
// running as service_role, outside this file - is the only thing that writes
// the subscriptions table. `authenticated` has no update grant on it at all.
//
// So this module can be read, tampered with, or replaced wholesale by anyone
// with dev tools open, and the worst they achieve is a page that lies to them
// about being subscribed while every request still comes back empty.
//
// CHECKOUT AND CANCELLATION
//
// Both are redirects to Stripe, minted by an Edge Function that holds the
// secret key. The card is collected on Stripe's domain, under Stripe's PCI
// scope; no card detail passes through this file, this site, or our database.
//
//   create-checkout-session  -> Stripe Checkout   (start a subscription)
//   create-portal-session    -> Stripe Portal     (cancel, change card, invoices)
//   stripe-webhook           -> the only writer of public.subscriptions
//
// Cancellation is deliberately Stripe's portal rather than a button here: a
// cancel flow of our own is one more place a bug could keep charging someone
// who asked us to stop.

var billingState = null
var billingLoading = null

function billingClient() {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || typeof authUser === "undefined" || authUser === null) return null
	return c
}

var BILLING_NONE = {
	status: "none", plan: "match_monthly",
	current_period_end: null, cancel_at_period_end: false, active: false
}

function billingLoad(force) {
	if (!force && billingState !== null) return Promise.resolve(billingState)
	if (!force && billingLoading !== null) return billingLoading

	var c = billingClient()
	if (c === null) return Promise.resolve(BILLING_NONE)

	// .catch rather than a second argument to .then: supabase-js RESOLVES with
	// { error } instead of rejecting, so the failure arrives inside the success
	// handler and a rejection handler sitting beside it never sees it.
	billingLoading = c.rpc("subscription_mine", {}).then(function (res) {
		if (res.error) throw res.error
		return (res.data && res.data.length) ? res.data[0] : BILLING_NONE
	}).catch(function () {
		// an unreachable server, or a migration that has not been run, is not a
		// subscription - and it is not a reason for the page to fail either,
		// because match_status() is what actually decides what to draw
		return BILLING_NONE
	}).then(function (row) {
		billingState = row
		billingLoading = null
		return row
	})
	return billingLoading
}

function billingActive() { return !!(billingState && billingState.active) }

function billingInvalidate() { billingState = null; billingLoading = null }

// "until 3 March 2027", or the honest blank when there is no end date - a
// comped account has none, and inventing one would be a lie on the page.
function billingRenewsLine(row) {
	if (!row || !row.current_period_end) return ""
	var d = new Date(row.current_period_end)
	if (!isFinite(d.getTime())) return ""
	var when = d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
	return (row.cancel_at_period_end ? "Ends " : "Renews ") + when
}

// ---- checkout and cancellation -----------------------------------------

// Both call an Edge Function, which authenticates from the session token the
// supabase client attaches. Neither sends a user id or a customer id: the
// function reads who the caller is from their own JWT, so a tampered body
// cannot start a subscription on somebody else's account or open their
// billing portal.
function billingInvoke(name) {
	var c = billingClient()
	if (c === null) return Promise.reject(new Error("Sign in first"))
	return c.functions.invoke(name, {
		// The origin is checked against an allow-list server-side before it is
		// used as a return URL. An unchecked return URL is an open redirect
		// wearing Stripe's branding.
		body: { origin: window.location.origin }
	}).then(function (res) {
		if (res.error) return billingFnReject(res.error)
		if (!res.data || !res.data.url) {
			throw new Error(billingFnMessage(res.data) || "Could not start that")
		}
		return res.data.url
	})
}

// On a non-2xx, supabase-js hands back a FunctionsHttpError whose .message is
// the useless "Edge Function returned a non-2xx status code" — the message we
// actually wrote is in the un-read response body on err.context. Reading it is
// the difference between "You already have an active subscription" and a
// sentence nobody can act on.
function billingFnReject(err) {
	var ctx = err && err.context
	if (ctx && typeof ctx.json === "function") {
		return ctx.json().then(function (body) {
			throw new Error(billingFnMessage(body) || err.message)
		}, function () {
			throw new Error(err.message || "Could not reach the billing service")
		})
	}
	return Promise.reject(new Error((err && err.message) || "Could not reach the billing service"))
}

function billingFnMessage(data) {
	if (data && typeof data.error === "string") return data.error
	return ""
}

function billingCheckout() {
	return billingInvoke("create-checkout-session").then(function (url) {
		window.location.href = url
		return url
	})
}

function billingPortal() {
	return billingInvoke("create-portal-session").then(function (url) {
		window.location.href = url
		return url
	})
}

// True once the member has ever had a Stripe customer, which is what decides
// whether "Manage subscription" is meaningful. Someone who never subscribed
// has no portal to open.
function billingHasCustomer() {
	return !!(billingState && billingState.has_customer)
}

function billingStatusLabel(row) {
	var s = row ? row.status : "none"
	if (s === "active")   return "Subscribed"
	if (s === "trialing") return "Trial"
	if (s === "comped")   return "Complimentary"
	if (s === "past_due") return "Payment failed"
	if (s === "paused")   return "Paused"
	if (s === "canceled") return "Cancelled"
	return "Not subscribed"
}

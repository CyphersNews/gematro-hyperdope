// ======================= Esoteric readings client =======================
//
// Three prompt types, one endpoint, and no prompt text on this side. The only
// thing this file sends is which reading, about whom, and — for a gematria
// explanation — the phrase the member is already looking at.
//
// That is deliberate. If the browser could send prompt text, the browser could
// send instructions, and the house rules in the Edge Function's system prompt
// would be a suggestion rather than a boundary. Everything the model is told
// about a chart is fetched server-side, under the caller's own token, from
// esoteric_context().

var ESOTERIC_KINDS = ["explain_gematria", "compatibility_summary", "deeper_reflection"]

function esotericClient() {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || typeof authUser === "undefined" || authUser === null) return null
	return c
}

// opts: { subject, phrase }
function esotericAsk(kind, opts) {
	var c = esotericClient()
	if (c === null) return Promise.reject(new Error("Sign in first"))
	if (ESOTERIC_KINDS.indexOf(kind) === -1) return Promise.reject(new Error("Unknown reading"))
	opts = opts || {}

	return c.functions.invoke("esoteric", {
		body: {
			kind: kind,
			subject: opts.subject || null,
			// clamped again server-side; this is politeness, not protection
			phrase: opts.phrase ? String(opts.phrase).slice(0, 120) : null
		}
	}).then(function (res) {
		if (res.error) return esotericReject(res.error)
		if (!res.data || typeof res.data.text !== "string") {
			throw new Error((res.data && res.data.error) || "Nothing came back")
		}
		return res.data
	})
}

// supabase-js reports any non-2xx as "Edge Function returned a non-2xx status
// code" and leaves the body we actually wrote unread on err.context. The rate
// limit message in particular is the whole point of the response, so it has to
// be dug out rather than swallowed.
function esotericReject(err) {
	var ctx = err && err.context
	if (ctx && typeof ctx.json === "function") {
		return ctx.json().then(function (body) {
			var e = new Error((body && body.error) || err.message)
			e.overLimit = !!(body && body.over_limit)
			throw e
		}, function () {
			throw new Error(err.message || "Could not reach the reading service")
		})
	}
	return Promise.reject(new Error((err && err.message) || "Could not reach the reading service"))
}

// What is left today. Read straight from the ledger the server enforces
// against, so the number on screen is the number that decides.
function esotericQuota() {
	var c = esotericClient()
	if (c === null) return Promise.resolve(null)
	return c.rpc("llm_quota", {}).then(function (res) {
		if (res.error) return null
		return (res.data && res.data.length) ? res.data[0] : null
	}, function () { return null })
}

// Readings are prose, not markup. The model is told to produce no markdown,
// but "told to" is not "cannot", so paragraphs are split on blank lines and
// every one is escaped. Nothing the model returns is ever set as HTML.
function esotericRender(text) {
	var parts = String(text).split(/\n\s*\n/)
	var o = ''
	for (var i = 0; i < parts.length; i++) {
		var p = parts[i].trim()
		if (p === "") continue
		o += '<p class="esoP">' + authEsc(p) + '</p>'
	}
	return o || '<p class="esoP">' + authEsc(String(text)) + '</p>'
}

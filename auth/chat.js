// ======================= Chat client =======================
//
// The filter in here is a courtesy, not a control. It exists so an obvious
// rejection is instant and free rather than a round trip, and so the sender is
// told before they press send. Everything it does, chat_send() does again on
// the server, where it cannot be skipped. If the two ever disagree, the server
// is right and this is a bug.
//
// Nothing here is allowed to be the only place a rule lives.

function chatClient() {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || typeof authUser === "undefined" || authUser === null) return null
	return c
}

function chatRpc(name, args) {
	var c = chatClient()
	if (c === null) return Promise.reject(new Error("Not signed in"))
	return c.rpc(name, args || {}).then(function (res) {
		if (res.error) throw friendsError(res.error) // same "run the migration" handling
		return res.data
	}, function (err) { throw friendsError(err) })
}

// ---- reading ----------------------------------------------------------

function chatThreads()            { return chatRpc("chat_threads").then(function (r) { return r || [] }) }
function chatHistory(id, limit)   { return chatRpc("chat_history", { target: id, lim: limit || 100 }).then(function (r) { return (r || []).reverse() }) }
function chatMarkRead(id)         { return chatRpc("chat_mark_read", { target: id }) }
function chatUnreadTotal()        { return chatRpc("chat_unread_total") }

// ---- sending ----------------------------------------------------------

var CHAT_MAX_LEN = 500

function chatSend(target, body) {
	var pre = chatPrecheck(body)
	if (!pre.ok) return Promise.reject(new Error(pre.why))
	return chatRpc("chat_send", { target: target, body: body })
}

// ---- blocking and reporting -------------------------------------------

function chatBlock(id)               { return chatRpc("member_block", { target: id }) }
function chatUnblock(id)             { return chatRpc("member_unblock", { target: id }) }
function chatBlockedList()           { return chatRpc("member_blocked_list").then(function (r) { return r || [] }) }
function chatReport(id, reason, det) { return chatRpc("member_report", { target: id, reason: reason, detail: det || null }) }

// ---- the local pre-check ----------------------------------------------
//
// A deliberately small subset of the server rules: the shapes, which are the
// ones a person can trip by accident and would rather be told about while they
// are still typing. Vocabulary is left to the server - shipping the word list
// to the browser would publish the filter, and knowing it exactly is most of
// the work of getting round it.

// Ordered the same way mod_check orders its categories - personal details
// before links - so that "joe@example.com" is reported as an email address
// rather than as a link. Both refuse it either way; the two just have to give
// the same reason, or the server contradicting this one looks like a bug.
var chatShapeRules = [
	{ re: /[a-z0-9._%+-]+\s*(@|\(at\)|\[at\])\s*[a-z0-9.-]+\s*(\.|\(dot\)|\[dot\])\s*[a-z]{2,}/i, why: "email addresses are not allowed" },
	{ re: /(\+?\d[\s().-]?){9,}/,                  why: "phone numbers are not allowed" },
	{ re: /\b0\d{3}[\s-]?\d{6,7}\b/,               why: "phone numbers are not allowed" },
	{ re: /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/, why: "postcodes are not allowed" },
	{ re: /\b\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\b/, why: "coordinates are not allowed" },
	{ re: /https?:\/\//i,                          why: "links are not allowed" },
	{ re: /www\.[a-z0-9-]+/i,                      why: "links are not allowed" },
	{ re: /[a-z0-9-]+\.(com|net|org|co\.uk|io|me|gg|ly|xyz|info|biz|tv|link|site|app)\b/i, why: "links are not allowed" },
	{ re: /<[a-z/][^>]*>/i,                        why: "HTML is not allowed" }
]

function chatPrecheck(body) {
	var text = String(body === undefined || body === null ? "" : body)
	var trimmed = text.trim()

	if (trimmed.length === 0) return { ok: false, why: "Nothing to send" }
	if (trimmed.length > CHAT_MAX_LEN) {
		return { ok: false, why: "Too long — " + CHAT_MAX_LEN + " characters at most" }
	}
	for (var i = 0; i < chatShapeRules.length; i++) {
		if (chatShapeRules[i].re.test(text)) {
			return { ok: false, why: "Message not sent — " + chatShapeRules[i].why }
		}
	}
	return { ok: true, why: null }
}

// ---- rendering as plain text ------------------------------------------
//
// Every message is escaped and then only line breaks are put back. No markdown
// is parsed, no link is made clickable, no image is embedded. A message that
// says "<b>hi</b>" reads as those characters, which is the whole of the
// "plain text only" rule on the display side.
//
// Emoji need nothing: they are ordinary characters and survive escaping.

function chatRenderBody(body) {
	return authEsc(String(body === null || body === undefined ? "" : body))
		.replace(/\r\n|\r|\n/g, "<br>")
}

// ---- unread badge -----------------------------------------------------

var chatUnreadCache = { at: 0, n: 0 }
var CHAT_UNREAD_TTL = 15000

function chatUnreadCached(force) {
	var now = Date.now()
	if (!force && (now - chatUnreadCache.at) < CHAT_UNREAD_TTL) return Promise.resolve(chatUnreadCache.n)
	return chatUnreadTotal().then(function (n) {
		chatUnreadCache = { at: Date.now(), n: Number(n) || 0 }
		return chatUnreadCache.n
	}).catch(function () { return chatUnreadCache.n })
}

function chatUnreadInvalidate() { chatUnreadCache = { at: 0, n: 0 } }

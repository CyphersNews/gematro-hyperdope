// ======================= Admin client =======================
//
// Every call here is an RPC whose first act, in the database, is
// admin_require(). Nothing in this file is a permission check - hiding the
// panel and greying out a button is presentation, and a member who opens the
// console gets the same refusal a member who does not would have got.
//
// So: if you are reading this looking for where admin access is decided, it is
// not here. It is admin_require() in 20260806030000_admin.sql.

function adminClient() {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || typeof authUser === "undefined" || authUser === null) return null
	return c
}

function adminErr(err) {
	var msg = (err && err.message) ? String(err.message) : "Something went wrong"
	if (/does not exist|schema cache|PGRST202/i.test(msg)) {
		return new Error("The admin migration has not been run on this database yet.")
	}
	return new Error(msg.replace(/^.*?:\s*/, "").trim() || "Something went wrong")
}

function adminRpc(name, args) {
	var c = adminClient()
	if (c === null) return Promise.reject(new Error("Not signed in"))
	return c.rpc(name, args || {}).then(function (res) {
		if (res.error) throw adminErr(res.error)
		return res.data
	}, function (err) { throw adminErr(err) })
}

// ---- am I one? --------------------------------------------------------
//
// Cached for the session. The answer only changes when another admin changes
// it, and if that happens mid-session the next privileged call fails properly
// rather than this being wrong in a way that matters.

var adminIsAdmin = null

function adminCheckSelf() {
	if (adminIsAdmin !== null) return Promise.resolve(adminIsAdmin)
	return adminRpc("is_admin", {}).then(function (v) {
		adminIsAdmin = !!v
		return adminIsAdmin
	}).catch(function () { adminIsAdmin = false; return false })
}

// ---- the badge --------------------------------------------------------
//
// One fetch of the admin ids, then any name anywhere can be decorated without
// changing the shape of the query that produced it. Adding is_admin to every
// list function would have meant altering half a dozen return types.

var adminIdSet = null
var adminIdsAt = 0
var ADMIN_IDS_TTL = 300000 // five minutes; staff lists do not churn

function adminIds() {
	var now = Date.now()
	if (adminIdSet !== null && (now - adminIdsAt) < ADMIN_IDS_TTL) return Promise.resolve(adminIdSet)
	return adminRpc("admin_list", {}).then(function (rows) {
		var set = {}
		;(rows || []).forEach(function (r) { set[r.id] = true })
		adminIdSet = set
		adminIdsAt = Date.now()
		return set
	}).catch(function () { return adminIdSet || {} })
}

function adminIsKnownAdmin(id) { return !!(adminIdSet && adminIdSet[id]) }

// The badge itself. Returned as markup so it can be dropped straight into the
// lists that already build their own HTML.
function adminBadgeHtml(id) {
	return adminIsKnownAdmin(id) ? '<span class="adminBadge" title="Administrator">&#128737; Admin</span>' : ''
}

// ---- reads ------------------------------------------------------------

function adminStats() {
	return adminRpc("admin_stats", {}).then(function (r) { return (r && r.length) ? r[0] : null })
}
function adminUsers(q, sort, status, limit, offset) {
	return adminRpc("admin_users", {
		q: q || null, sort: sort || "recent", status_filter: status || null,
		lim: limit || 50, off: offset || 0
	}).then(rowsOr)
}
function adminOnline(mins)         { return adminRpc("admin_online", { window_minutes: mins || 5 }).then(rowsOr) }
function adminReports(status, sort){ return adminRpc("admin_reports", { status_filter: status || null, sort: sort || "newest" }).then(rowsOr) }
function adminReportContext(id)    { return adminRpc("admin_report_context", { report: id }).then(rowsOr) }
function adminAudit(limit)         { return adminRpc("admin_audit_list", { lim: limit || 100 }).then(rowsOr) }

function rowsOr(r) { return r || [] }

// ---- writes -----------------------------------------------------------

function adminSetStatus(id, status, reason, until) {
	return adminRpc("admin_set_status", { target: id, new_status: status, reason: reason || null, until: until || null })
}
function adminSetAdmin(id, on)     { return adminRpc("admin_set_admin", { target: id, make_admin: !!on }) }
function adminDeleteUser(id)       { return adminRpc("admin_delete_user", { target: id }) }
function adminReportStatus(id, s, note) {
	return adminRpc("admin_report_status", { report: id, new_status: s, note: note || null })
}

// Password resets go through the ordinary reset endpoint rather than an admin
// one: it emails the address on file and does not need - or grant - any
// elevated rights. An admin triggering it learns nothing they did not know.
function adminSendReset(email) {
	var c = adminClient()
	if (c === null) return Promise.reject(new Error("Not signed in"))
	if (!email) return Promise.reject(new Error("That account has no email address"))
	return c.auth.resetPasswordForEmail(email, {
		redirectTo: window.location.origin + "/reset-password.html"
	}).then(function (res) {
		if (res.error) throw adminErr(res.error)
		return true
	})
}

// ---- presence ---------------------------------------------------------

function adminOnlineNow(lastActiveAt) {
	if (!lastActiveAt) return false
	var t = Date.parse(lastActiveAt)
	return isFinite(t) && (Date.now() - t) < 5 * 60 * 1000
}

// ---- wiring -----------------------------------------------------------
//
// Loaded on the calculator as well as the panel, so the badge can be drawn and
// the nav can offer the shortcut. Both are cosmetic; the panel and every
// function behind it check for themselves.

$(document).ready(function () {
	if (typeof onAuthReady !== "function") return
	onAuthReady(function (user) {
		if (user === null) return
		adminIds()
		adminCheckSelf().then(function (yes) {
			if (yes && typeof renderAuthNav === "function") renderAuthNav()
		})
	})
})

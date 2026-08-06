// ======================= Friends client =======================
//
// A thin wrapper over the functions in 20260806000000_friends.sql. Every rule
// - who may accept, who may cancel, whether a member is accepting requests at
// all - lives in the database, so nothing here needs to enforce anything. That
// is deliberate: a rule that only exists in this file is a rule anyone can
// skip by opening the console.
//
// Each call resolves to plain data or rejects with a message fit to show. The
// one case worth special handling is the migration not having been run yet:
// Postgres answers "function does not exist", which would otherwise reach the
// user as noise.

var FRIENDS_READY = null // null = not yet known, true/false once we have asked

function friendsClient() {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || typeof authUser === "undefined" || authUser === null) return null
	return c
}

// Turns a Postgres error into something worth reading, and notices the one
// that means "you have not run the migration".
function friendsError(err) {
	var msg = (err && err.message) ? String(err.message) : "Something went wrong"
	if (/does not exist|schema cache|PGRST202/i.test(msg)) {
		FRIENDS_READY = false
		return new Error("Friends is not set up on this database yet — run the friends migration.")
	}
	// the raise exception messages from the functions arrive verbatim, and are
	// already written to be read
	return new Error(msg.replace(/^.*?:\s*/, "").trim() || "Something went wrong")
}

function friendsRpc(name, args) {
	var c = friendsClient()
	if (c === null) return Promise.reject(new Error("Not signed in"))
	return c.rpc(name, args || {}).then(function (res) {
		if (res.error) throw friendsError(res.error)
		FRIENDS_READY = true
		return res.data
	}, function (err) { throw friendsError(err) })
}

// ---- reading ----------------------------------------------------------

function friendsCounts() {
	// the rpc returns a single row as a one-element array
	return friendsRpc("friend_counts").then(function (rows) {
		var r = (rows && rows.length) ? rows[0] : null
		return {
			friends: r ? Number(r.friends) || 0 : 0,
			incoming: r ? Number(r.incoming) || 0 : 0,
			outgoing: r ? Number(r.outgoing) || 0 : 0
		}
	})
}

function friendsList(sort) {
	return friendsRpc("friend_list", { sort: sort || "recent" }).then(rowsOrEmpty)
}

function friendsRequests(direction) {
	return friendsRpc("friend_requests", { direction: direction || "incoming" }).then(rowsOrEmpty)
}

function friendsSearch(term, limit) {
	var q = String(term || "").trim()
	if (q === "") return Promise.resolve([])
	return friendsRpc("member_search", { q: q, lim: limit || 20 }).then(rowsOrEmpty)
}

function friendsDiscover(kind, limit) {
	return friendsRpc("member_discover", { kind: kind || "popular", lim: limit || 12 }).then(rowsOrEmpty)
}

function friendsProfile(userId) {
	return friendsRpc("member_profile", { target: userId }).then(function (rows) {
		return (rows && rows.length) ? rows[0] : null // null means private, or gone
	})
}

function rowsOrEmpty(rows) { return rows || [] }

// ---- the verbs --------------------------------------------------------
//
// All four resolve to the resulting state word, so a caller can re-render from
// the answer rather than reading the list back.

function friendsAdd(userId)     { return friendsRpc("friend_request", { target: userId }) }
function friendsCancel(userId)  { return friendsRpc("friend_cancel", { target: userId }) }
function friendsRemove(userId)  { return friendsRpc("friend_remove", { target: userId }) }
function friendsAccept(userId)  { return friendsRpc("friend_respond", { target: userId, accept: true }) }
function friendsDecline(userId) { return friendsRpc("friend_respond", { target: userId, accept: false }) }

// ---- privacy ----------------------------------------------------------
//
// These are columns on the caller's own profile row, which they can already
// read and update under the existing policy, so no function is needed.

var FRIENDS_PRIVACY_KEYS = [
	"friend_policy", "show_online", "show_last_active", "show_mutuals", "public_profile"
]

function friendsPrivacyGet() {
	var c = friendsClient()
	if (c === null) return Promise.reject(new Error("Not signed in"))
	return c.from("profiles").select(FRIENDS_PRIVACY_KEYS.join(", ")).eq("id", authUser.id).maybeSingle()
		.then(function (res) {
			if (res.error) throw friendsError(res.error)
			return res.data || {}
		})
}

function friendsPrivacySet(patch) {
	var c = friendsClient()
	if (c === null) return Promise.reject(new Error("Not signed in"))
	var clean = {}
	for (var i = 0; i < FRIENDS_PRIVACY_KEYS.length; i++) {
		var k = FRIENDS_PRIVACY_KEYS[i]
		if (patch[k] !== undefined) clean[k] = patch[k]
	}
	if (!Object.keys(clean).length) return Promise.resolve({})
	return c.from("profiles").update(clean).eq("id", authUser.id)
		.then(function (res) {
			if (res.error) throw friendsError(res.error)
			return clean
		})
}

// ---- presence ---------------------------------------------------------
//
// A heartbeat while the tab is open rather than a flag that is set on arrival
// and cleared on departure: a browser that closes without warning never sends
// the second one, and the member is left showing online for ever. "Online"
// then means "seen in the last few minutes", which is a question this can
// always answer honestly.

var FRIENDS_ONLINE_WINDOW_MS = 5 * 60 * 1000
var friendsHeartbeatTimer = null

function friendsIsOnline(lastActiveAt) {
	if (!lastActiveAt) return false
	var t = Date.parse(lastActiveAt)
	return isFinite(t) && (Date.now() - t) < FRIENDS_ONLINE_WINDOW_MS
}

function friendsHeartbeat() {
	if (FRIENDS_READY === false) return Promise.resolve()
	return friendsRpc("touch_last_active").catch(function () { /* presence is not worth a message */ })
}

function friendsHeartbeatStart() {
	if (friendsHeartbeatTimer !== null) return
	friendsHeartbeat()
	// half the window, so a member never flickers offline between beats
	friendsHeartbeatTimer = setInterval(friendsHeartbeat, FRIENDS_ONLINE_WINDOW_MS / 2)
}

function friendsHeartbeatStop() {
	if (friendsHeartbeatTimer !== null) { clearInterval(friendsHeartbeatTimer); friendsHeartbeatTimer = null }
}

// ---- badge ------------------------------------------------------------
//
// The unread count for the Friends tab. Cached for a few seconds because
// every panel render asks for it, and it is the same answer each time.

var friendsBadgeCache = { at: 0, counts: null }
var FRIENDS_BADGE_TTL = 15000

function friendsBadgeCounts(force) {
	var now = Date.now()
	if (!force && friendsBadgeCache.counts && (now - friendsBadgeCache.at) < FRIENDS_BADGE_TTL) {
		return Promise.resolve(friendsBadgeCache.counts)
	}
	return friendsCounts().then(function (c) {
		friendsBadgeCache = { at: Date.now(), counts: c }
		return c
	}).catch(function () {
		return friendsBadgeCache.counts || { friends: 0, incoming: 0, outgoing: 0 }
	})
}

function friendsBadgeInvalidate() { friendsBadgeCache = { at: 0, counts: null } }

// ---- wiring -----------------------------------------------------------

$(document).ready(function () {
	if (typeof onAuthReady !== "function") return
	onAuthReady(function (user) {
		if (user === null) return
		friendsHeartbeatStart()
		// warm the badge so the tab shows its number on first open
		friendsBadgeCounts().then(function () {
			if (typeof friendsRefreshBadge === "function") friendsRefreshBadge()
		})
	})

	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c !== null) {
		c.auth.onAuthStateChange(function (event) {
			if (event === "SIGNED_OUT") { friendsHeartbeatStop(); friendsBadgeInvalidate() }
			else if (event === "SIGNED_IN") friendsHeartbeatStart()
		})
	}
})

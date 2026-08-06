// ======================= Friends tab =======================
//
// Four sections behind one tab: your friends, the requests waiting on you,
// people to find, and who is allowed to ask. They share one member-card
// renderer, because every list is the same thing - somebody, and what you can
// do about them - and the only difference is which buttons apply.
//
// Nothing here decides what is allowed. The card asks the row it was given
// what state it is in and draws the matching buttons; the database decides
// whether the action goes through. A card drawn from stale data can therefore
// offer a button that then fails, which is the right way round: the failure is
// a message, not a wrong friendship.

var friendsSection = "friends"   // friends | requests | discover | privacy
var friendsSort = "recent"
var friendsDiscoverKind = "popular"
var friendsSearchTerm = ""
var friendsViewing = null        // a member id when their profile is open
var chatOpenWith = null          // a member id when a conversation is open
var chatPollTimer = null

// ---- entry point ------------------------------------------------------

function renderProfileFriends() {
	var tok = profileRenderSeq

	if (chatOpenWith !== null) { frRenderChatWindow(chatOpenWith, tok); return }
	if (friendsViewing !== null) { renderFriendProfile(friendsViewing, tok); return }

	// the unread count is fetched with the others rather than read from cache:
	// a badge that is only right on a second visit is worse than none
	Promise.all([friendsBadgeCounts(true), chatUnreadCached(true)]).then(function (both) {
		var counts = both[0]
		var o = ''
		var news = frNewsCounts(counts)
		o += '<div class="frTabs">'
		o += frSectionBtn("friends",  "&#128101;", "Friends",  news.friends)
		o += frSectionBtn("chats",    "&#128172;", "Chats",    news.chats)
		o += frSectionBtn("requests", "&#128233;", "Requests", news.requests)
		o += frSectionBtn("discover", "&#128269;", "Discover", 0)
		o += frSectionBtn("profile",  "&#129489;", "Profile",  0)
		o += frSectionBtn("privacy",  "&#9881;",   "Privacy",  0, !friendsSeenFlag("privacy"))
		o += '</div>'
		o += '<div id="frBody"></div>'
		profileBody(o, tok)
		friendsRefreshBadge()

		if (friendsSection === "requests") frRenderRequests(tok, counts)
		else if (friendsSection === "chats") frRenderChats(tok)
		else if (friendsSection === "discover") frRenderDiscover(tok)
		else if (friendsSection === "profile") frRenderMyProfile(tok)
		else if (friendsSection === "privacy") frRenderPrivacy(tok)
		else frRenderFriends(tok)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

// Icon above the word, so six sections fit a phone without wrapping into a
// second row of buttons that would read as a second menu.
//
// Two different marks, because they mean different things: a number is news
// you have not seen, and a pip is a section you have never opened.
function frSectionBtn(id, icon, label, badge, pip) {
	var on = (friendsSection === id) ? " frTabOn" : ""
	var o = '<button class="intBtn3 frTab' + on + '" onclick="frSetSection(&quot;' + id + '&quot;)" title="' + label + '">'
	o += '<span class="frTabIcon">' + icon + '</span>'
	o += '<span class="frTabLab">' + label + '</span>'
	if (badge > 0) o += '<span class="frBadge">' + (badge > 99 ? "99+" : badge) + '</span>'
	else if (pip) o += '<span class="frPip" title="Worth a look">&#10022;</span>'
	o += '</button>'
	return o
}

// What is actually new, as opposed to what merely exists.
//
// The friend count used to be red permanently, which made it decoration - a
// badge that is always on says nothing. It is now the number of friends gained
// since the Friends list was last opened, so it is news exactly once.
function frNewsCounts(counts) {
	return {
		friends: Math.max(0, counts.friends - friendsSeenGet("friends")),
		requests: counts.incoming,   // a pending request stays news until answered
		chats: chatUnreadCache.n     // unread is "not seen" by definition
	}
}

function frNewsTotal(counts) {
	var n = frNewsCounts(counts)
	return n.friends + n.requests + n.chats
}

function frSetSection(id) {
	friendsSection = id
	friendsViewing = null
	chatOpenWith = null
	if (typeof frStopChatPoll === "function") frStopChatPoll()
	// opening a section is what marks it seen
	if (id === "privacy") friendsSeenMark("privacy")
	if (id === "friends" && friendsBadgeCache.counts) {
		friendsSeenSet("friends", friendsBadgeCache.counts.friends)
	}
	renderProfileFriends()
}

function frBody(html, token) {
	if (token !== undefined && token !== profileRenderSeq) return
	var el = document.getElementById("frBody")
	if (el !== null) el.innerHTML = html
}

// ---- the member card --------------------------------------------------
//
// One row: avatar, who they are, and the buttons that apply to the state the
// row arrived in.

function frOnlineDot(row) {
	if (!row.last_active_at) return ''
	var on = friendsIsOnline(row.last_active_at)
	return '<span class="frDot' + (on ? ' frDotOn' : '') + '" title="' +
		(on ? 'Online now' : 'Last seen ' + frWhen(row.last_active_at)) + '"></span>'
}

function frAvatar(row) {
	if (row.avatar) return '<img class="frAvatar" src="' + authEsc(row.avatar) + '" alt="">'
	var initial = String(row.display_name || "?").charAt(0).toUpperCase()
	return '<span class="frAvatar frAvatarFallback">' + authEsc(initial) + '</span>'
}

// "3 minutes ago" down to a date, because "2026-08-06T11:04:22Z" is not an
// answer to "when"
function frWhen(iso) {
	if (!iso) return ""
	var t = Date.parse(iso)
	if (!isFinite(t)) return ""
	var s = Math.floor((Date.now() - t) / 1000)
	if (s < 60) return "just now"
	if (s < 3600) return Math.floor(s / 60) + "m ago"
	if (s < 86400) return Math.floor(s / 3600) + "h ago"
	if (s < 2592000) return Math.floor(s / 86400) + "d ago"
	return new Date(t).toLocaleDateString()
}

function frCard(row, opts) {
	opts = opts || {}
	var id = row.id
	var o = '<div class="profileRow frRow" data-uid="' + id + '">'

	o += frAvatar(row)
	o += '<span class="frWho" onclick="frOpenProfile(&quot;' + id + '&quot;)" title="See their profile">'
	o += '<span class="frName">' + authEsc(row.display_name) + frAdminBadge(row.id) + frOnlineDot(row) + '</span>'
	var sub = []
	if (row.username && row.username !== row.display_name) sub.push('@' + row.username)
	if (opts.since) sub.push("friends since " + new Date(row.since).toLocaleDateString())
	else if (opts.asked) sub.push("asked " + frWhen(row.asked_at))
	else if (opts.joined) sub.push("joined " + new Date(row.joined_at).toLocaleDateString())
	if (row.mutuals > 0) sub.push(row.mutuals + (row.mutuals === 1 ? " mutual friend" : " mutual friends"))
	if (sub.length) o += '<span class="frSub">' + authEsc(sub.join(" · ")) + '</span>'
	o += '</span>'

	o += '<span class="profileRowActions frActions">' + frButtons(row, opts) + '</span>'
	o += '</div>'
	return o
}

// The buttons for a state. Kept in one place so every list offers the same
// verbs for the same situation.
function frButtons(row, opts) {
	var id = row.id
	var state = opts.state || row.state || "none"
	var q = function (s) { return '&quot;' + s + '&quot;' }

	if (state === "self") return '<span class="profileBadge">you</span>'
	if (state === "blocked") return '<span class="profileBadge">blocked</span>'

	if (state === "friends") {
		return '<button class="profileMiniBtn frMsg" onclick="frOpenChat(&quot;' + id + '&quot;)" title="Send a message">Message</button>' +
			'<button class="profileMiniBtn profileMiniDanger" onclick="frAct(this,' + q(id) + ',&quot;remove&quot;)">Remove</button>'
	}
	if (state === "sent") {
		return '<span class="profileBadge">asked</span>' +
			'<button class="profileMiniBtn" onclick="frAct(this,' + q(id) + ',&quot;cancel&quot;)">Cancel</button>'
	}
	if (state === "received") {
		return '<button class="profileMiniBtn frAccept" onclick="frAct(this,' + q(id) + ',&quot;accept&quot;)">Accept</button>' +
			'<button class="profileMiniBtn" onclick="frAct(this,' + q(id) + ',&quot;decline&quot;)">Decline</button>'
	}
	return '<button class="profileMiniBtn frAdd" onclick="frAct(this,' + q(id) + ',&quot;add&quot;)">Add friend</button>'
}

// Every button goes through here: disable, call, re-render on the state the
// database hands back. Removing and declining ask twice, because both throw
// something away that the other person has to re-do.
function frAct(btn, id, verb) {
	if ((verb === "remove" || verb === "decline") && !profileConfirmClick(btn, "Sure?")) return

	var call =
		verb === "add"     ? friendsAdd(id) :
		verb === "cancel"  ? friendsCancel(id) :
		verb === "accept"  ? friendsAccept(id) :
		verb === "decline" ? friendsDecline(id) :
		verb === "remove"  ? friendsRemove(id) : null
	if (call === null) return

	btn.disabled = true
	call.then(function () {
		friendsBadgeInvalidate()
		renderProfileFriends()
		displayCalcNotification(frDoneWord(verb), 1800)
	}).catch(function (err) {
		btn.disabled = false
		displayCalcNotification(err.message || "That did not work", 2800)
		renderProfileFriends()
	})
}

function frDoneWord(verb) {
	return verb === "add" ? "Friend request sent"
		: verb === "cancel" ? "Request withdrawn"
		: verb === "accept" ? "Friend added"
		: verb === "decline" ? "Request declined"
		: "Friend removed"
}

// ---- friends ----------------------------------------------------------

function frRenderFriends(tok) {
	frBody('<div class="profileLoading">Loading…</div>', tok)
	friendsList(friendsSort).then(function (rows) {
		var o = ''
		// One control instead of three buttons. Sorting is a choice between
		// mutually exclusive options, which is what a select is for, and as
		// chips it took a third of the panel and read as part of the menu.
		o += '<div class="frToolbar">'
		o += '<label class="frToolLab" for="frSortSel">Sort</label>'
		o += '<select id="frSortSel" class="frSelect" onchange="frSetSort(this.value)">'
		o += frSortOpt("recent", "&#128338; Recently added")
		o += frSortOpt("name",   "&#128292; A&ndash;Z")
		o += frSortOpt("online", "&#128994; Online first")
		o += '</select>'
		o += '<span class="frToolCount">' + rows.length + (rows.length === 1 ? ' friend' : ' friends') + '</span>'
		o += '</div>'

		if (!rows.length) {
			o += '<div class="profileNote">No friends yet. Find people under <b>Discover</b>, or search for someone by name.</div>'
			frBody(o, tok); return
		}
		o += '<div class="profileList">'
		for (var i = 0; i < rows.length; i++) {
			rows[i].state = "friends"
			o += frCard(rows[i], { state: "friends", since: true })
		}
		o += '</div>'
		frBody(o, tok)
	}).catch(function (err) { frBody(profileErr(err), tok) })
}

function frSortOpt(id, label) {
	return '<option value="' + id + '"' + (friendsSort === id ? ' selected' : '') + '>' + label + '</option>'
}

function frSetSort(s) { friendsSort = s; frRenderFriends(profileRenderSeq) }

// ---- requests ---------------------------------------------------------

function frRenderRequests(tok, counts) {
	frBody('<div class="profileLoading">Loading…</div>', tok)
	Promise.all([friendsRequests("incoming"), friendsRequests("outgoing")]).then(function (both) {
		var inc = both[0], out = both[1], i
		var o = ''

		o += '<div class="frSectionTitle">Waiting for you'
		if (inc.length) o += ' <span class="frBadge frBadgeInline">' + inc.length + '</span>'
		o += '</div>'
		if (!inc.length) o += '<div class="profileNote">Nothing waiting.</div>'
		else {
			o += '<div class="profileList">'
			for (i = 0; i < inc.length; i++) o += frCard(inc[i], { state: "received", asked: true })
			o += '</div>'
		}

		o += '<div class="frSectionTitle">Sent by you</div>'
		if (!out.length) o += '<div class="profileNote">None outstanding.</div>'
		else {
			o += '<div class="profileList">'
			for (i = 0; i < out.length; i++) o += frCard(out[i], { state: "sent", asked: true })
			o += '</div>'
		}
		frBody(o, tok)
	}).catch(function (err) { frBody(profileErr(err), tok) })
}

// ---- discover ---------------------------------------------------------
//
// Search and browse in one place: typing takes over from the browse lists,
// because a search is a more specific version of the same question.

function frRenderDiscover(tok) {
	var o = ''
	o += '<div class="profileSearchRow">'
	o += '<input type="text" id="frSearch" class="profileSearchInput" placeholder="Search members by name…" '
	o += 'autocomplete="off" spellcheck="false" value="' + authEsc(friendsSearchTerm) + '" oninput="frSearchDebounced()">'
	o += '</div>'
	o += '<div id="frDiscoverBody"></div>'
	frBody(o, tok)
	frDiscoverBody(tok)
}

var frSearchTimer = null
function frSearchDebounced() {
	clearTimeout(frSearchTimer)
	var box = document.getElementById("frSearch")
	friendsSearchTerm = (box === null) ? "" : box.value
	frSearchTimer = setTimeout(function () { frDiscoverBody(profileRenderSeq) }, 220)
}

function frDiscoverBody(tok) {
	var host = function (html) {
		if (tok !== undefined && tok !== profileRenderSeq) return
		var el = document.getElementById("frDiscoverBody")
		if (el !== null) el.innerHTML = html
	}

	var term = String(friendsSearchTerm || "").trim()
	if (term !== "") {
		friendsSearch(term, 30).then(function (rows) {
			var o = '<div class="frSectionTitle">' + rows.length + (rows.length === 1 ? " match" : " matches") + '</div>'
			if (!rows.length) o += '<div class="profileNote">Nobody by that name. Members who have hidden their profile do not appear.</div>'
			else {
				o += '<div class="profileList">'
				for (var i = 0; i < rows.length; i++) o += frCard(rows[i], { joined: true })
				o += '</div>'
			}
			host(o)
		}).catch(function (err) { host(profileErr(err)) })
		return
	}

	var kinds = [
		["popular", "Top contributors"],
		["similar", "Uses your cyphers"],
		["mutual", "Friends of friends"],
		["active", "Recently active"],
		["recent", "Newly joined"]
	]
	var o = '<div class="frToolbar">'
	for (var k = 0; k < kinds.length; k++) {
		var on = (friendsDiscoverKind === kinds[k][0]) ? " frChipOn" : ""
		o += '<button class="intBtn3 frChip' + on + '" onclick="frSetDiscover(&quot;' + kinds[k][0] + '&quot;)">' + kinds[k][1] + '</button>'
	}
	o += '</div><div id="frDiscoverList"><div class="profileLoading">Loading…</div></div>'
	host(o)

	friendsDiscover(friendsDiscoverKind, 20).then(function (rows) {
		var out = ''
		if (!rows.length) out = '<div class="profileNote">' + frEmptyWord(friendsDiscoverKind) + '</div>'
		else {
			out = '<div class="profileList">'
			for (var i = 0; i < rows.length; i++) out += frCard(rows[i], { joined: true })
			out += '</div>'
		}
		if (tok !== undefined && tok !== profileRenderSeq) return
		var el = document.getElementById("frDiscoverList")
		if (el !== null) el.innerHTML = out
	}).catch(function (err) {
		var el = document.getElementById("frDiscoverList")
		if (el !== null) el.innerHTML = profileErr(err)
	})
}

function frEmptyWord(kind) {
	if (kind === "similar") return "Nobody else has published in the cyphers you use. Publish a few phrases and this fills up."
	if (kind === "mutual") return "No friends of friends yet — that needs a friend or two first."
	if (kind === "active") return "Nobody else has been active recently."
	if (kind === "popular") return "Nobody has published a phrase yet."
	return "No new members to show."
}

function frSetDiscover(kind) { friendsDiscoverKind = kind; frDiscoverBody(profileRenderSeq) }

// ---- one member's profile ---------------------------------------------

function frOpenProfile(id) { friendsViewing = id; renderProfileFriends() }
function frCloseProfile() { friendsViewing = null; renderProfileFriends() }

function renderFriendProfile(id, tok) {
	profileBody('<div class="profileLoading">Loading…</div>', tok)
	Promise.all([friendsProfile(id), friendsRoleOptions()]).then(function (both) {
		var p = both[0]
		if (p === null) {
			profileBody('<div class="frBack"><button class="profileMiniBtn" onclick="frCloseProfile()">&larr; Back</button></div>' +
				'<div class="profileNote">That profile is private.</div>', tok)
			return
		}
		var o = '<div class="frBack"><button class="profileMiniBtn" onclick="frCloseProfile()">&larr; Back</button></div>'
		o += frProfileBodyHtml(p)
		profileBody(o, tok)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

// One renderer for a public profile, used both by the Profile tab - where you
// are looking at your own - and by everyone else looking at yours. Two
// renderers would drift, and "what they see" would stop being true.
function frProfileBodyHtml(p) {
	var o = '<div class="frProfile">'

	o += '<div class="frProfileHead">'
	o += frAvatar(p).replace("frAvatar", "frAvatar frAvatarBig")
	o += '<div class="frProfileWho">'
	o += '<div class="frProfileName">' + authEsc(p.display_name) + frAdminBadge(p.id) + frOnlineDot(p) + '</div>'
	if (p.username && p.username !== p.display_name) o += '<div class="frSub">@' + authEsc(p.username) + '</div>'
	o += '<div class="frSub">&#128197; Member since ' + new Date(p.joined_at).toLocaleDateString() + '</div>'
	o += '</div>'
	// no buttons against yourself: frButtons returns the "you" badge for state
	// "self", which is exactly right in the preview
	o += '<div class="frProfileActions">' + frButtons(p, { state: p.state }) + '</div>'
	o += '</div>'

	if (p.roles && p.roles.length) {
		o += '<div class="frRoleShow">'
		for (var r = 0; r < p.roles.length; r++) {
			o += '<span class="frRoleTag">' + authEsc(friendsRoleLabel(p.roles[r])) + '</span>'
		}
		o += '</div>'
	}

	if (p.fav_ciphers && p.fav_ciphers.length) {
		o += '<div class="frFavShow"><span class="frFavLab">&#128302; Favourite cyphers</span>'
		for (var f = 0; f < p.fav_ciphers.length; f++) {
			var col = (typeof profileCipherColor === "function") ? profileCipherColor(p.fav_ciphers[f]) : null
			o += '<span class="frFav"' + (col ? ' style="color:' + col + ';border-color:' + col + '"' : '') + '>'
			o += authEsc(p.fav_ciphers[f]) + '</span>'
		}
		o += '</div>'
	}

	o += '<div class="frStats">'
	o += frStat(p.rank ? "#" + p.rank : "—", "Leaderboard")
	o += frStat(p.submissions, p.submissions === 1 ? "Phrase published" : "Phrases published")
	o += frStat(p.ciphers_used, p.ciphers_used === 1 ? "Cypher used" : "Cyphers used")
	// null means they have chosen not to show it, which is different from none
	if (p.friends !== null && p.friends !== undefined) {
		o += frStat(p.friends, p.friends === 1 ? "Friend" : "Friends")
	}
	if (p.mutuals > 0) o += frStat(p.mutuals, p.mutuals === 1 ? "Mutual friend" : "Mutual friends")
	o += '</div>'

	var badges = frBadgesFor(p)
	if (badges.length) {
		o += '<div class="frSectionTitle">Badges</div><div class="frBadgeRow">'
		for (var i = 0; i < badges.length; i++) {
			o += '<span class="frAward" title="' + authEsc(badges[i].why) + '">' + badges[i].icon + ' ' + authEsc(badges[i].name) + '</span>'
		}
		o += '</div>'
	}
	o += '</div>'
	return o
}

function frStat(value, label) {
	return '<div class="frStat"><div class="frStatVal">' + authEsc(String(value)) + '</div>' +
		'<div class="frStatLab">' + authEsc(label) + '</div></div>'
}

// Earned from what the database already knows, rather than a badge table
// nobody would ever award from. Every one of these is checkable.
function frBadgesFor(p) {
	var out = []
	if (p.rank === 1) out.push({ icon: "&#129351;", name: "Top contributor", why: "First on the leaderboard" })
	else if (p.rank && p.rank <= 3) out.push({ icon: "&#127941;", name: "Top three", why: "Third or better on the leaderboard" })
	else if (p.rank && p.rank <= 10) out.push({ icon: "&#11088;", name: "Top ten", why: "Tenth or better on the leaderboard" })

	if (p.submissions >= 100) out.push({ icon: "&#128220;", name: "Century", why: "100 phrases published" })
	else if (p.submissions >= 25) out.push({ icon: "&#128221;", name: "Prolific", why: "25 phrases published" })
	else if (p.submissions >= 1) out.push({ icon: "&#9997;", name: "Published", why: "Has published a phrase" })

	if (p.ciphers_used >= 10) out.push({ icon: "&#128302;", name: "Polyglot", why: "Published in ten or more cyphers" })

	var days = (Date.now() - Date.parse(p.joined_at)) / 86400000
	if (isFinite(days) && days >= 365) out.push({ icon: "&#127881;", name: "A year in", why: "Member for over a year" })
	return out
}

// ---- privacy ----------------------------------------------------------

function frRenderPrivacy(tok) {
	frBody('<div class="profileLoading">Loading…</div>', tok)
	Promise.all([friendsPrivacyGet(), friendsRoleOptions()]).then(function (both) {
		var s = both[0]
		var o = ''

		// One question, three answers, laid out as cards you press rather than
		// boxes you tick. The old row of chips read as a filter - something you
		// were narrowing - when it is a single choice about who may contact you.
		o += '<div class="frPrivHead">&#128274; Who can send you a friend request?</div>'
		o += '<div class="frChoice">'
		o += frChoiceCard(s.friend_policy, "everyone", "&#127758;", "Everyone",
			"Any signed-in member can ask.")
		o += frChoiceCard(s.friend_policy, "friends_of_friends", "&#128101;", "Friends of friends",
			"Only people who already share a friend with you.")
		o += frChoiceCard(s.friend_policy, "nobody", "&#128275;", "Nobody",
			"Nobody can ask. You can still send requests yourself.")
		o += '</div>'

		o += '<div class="frPrivHead">&#128065; What others can see</div>'
		o += frSwitch("public_profile", s.public_profile, "&#127760;", "My profile",
			"Off hides you from search and discovery completely.")
		o += frSwitch("show_online", s.show_online, "&#128994;", "When I am online", "")
		o += frSwitch("show_last_active", s.show_last_active, "&#128338;", "When I was last active", "")
		o += frSwitch("show_mutuals", s.show_mutuals, "&#129309;", "Mutual friends", "")
		o += frSwitch("show_friend_count", s.show_friend_count, "&#128101;", "How many friends I have", "")

		o += '<div class="frPrivFoot">&#128274; Your email address is never shown to anyone, whatever these are set to.</div>'
		frBody(o, tok)
	}).catch(function (err) { frBody(profileErr(err), tok) })
}

function frChoiceCard(current, value, icon, title, blurb) {
	// "members" and "everyone" mean the same thing while the whole social layer
	// needs an account, so a row set to either lights the same card
	var on = (current === value || (value === "everyone" && current === "members"))
	var o = '<button class="frChoiceCard' + (on ? ' frChoiceOn' : '') + '" onclick="frSetPolicy(&quot;' + value + '&quot;)">'
	o += '<span class="frChoiceIcon">' + icon + '</span>'
	o += '<span class="frChoiceBody"><span class="frChoiceTitle">' + title + '</span>'
	o += '<span class="frChoiceBlurb">' + blurb + '</span></span>'
	o += '<span class="frChoiceTick">' + (on ? '&#10003;' : '') + '</span>'
	o += '</button>'
	return o
}

// A real switch rather than a tickbox: the whole row is the target, it is
// obvious which way is on, and green against grey says the state without
// anything having to be read.
function frSwitch(key, value, icon, title, blurb) {
	var o = '<div class="frSwitchRow' + (value ? ' frSwitchOn' : '') + '" onclick="frToggleSwitch(this,&quot;' + key + '&quot;)">'
	o += '<span class="frSwitchIcon">' + icon + '</span>'
	o += '<span class="frSwitchBody"><span class="frSwitchTitle">' + title + '</span>'
	if (blurb) o += '<span class="frSwitchBlurb">' + blurb + '</span>'
	o += '</span>'
	o += '<span class="frSwitch" role="switch" aria-checked="' + (value ? 'true' : 'false') + '"><span class="frSwitchKnob"></span></span>'
	o += '</div>'
	return o
}

// Flipped in place and saved in the background, then put back if the save
// fails - so the switch never shows a state the database does not have.
function frToggleSwitch(row, key) {
	var on = !row.classList.contains("frSwitchOn")
	row.classList.toggle("frSwitchOn", on)
	var sw = row.querySelector(".frSwitch")
	if (sw !== null) sw.setAttribute("aria-checked", on ? "true" : "false")

	var patch = {}
	patch[key] = on
	friendsPrivacySet(patch).catch(function (err) {
		row.classList.toggle("frSwitchOn", !on)
		if (sw !== null) sw.setAttribute("aria-checked", !on ? "true" : "false")
		displayCalcNotification(err.message || "Could not save", 2600)
	})
}

function frSetPolicy(value) {
	friendsPrivacySet({ friend_policy: value }).then(function () {
		displayCalcNotification("Saved", 1400)
		frRenderPrivacy(profileRenderSeq)
	}).catch(function (err) { displayCalcNotification(err.message || "Could not save", 2600) })
}

// ---- your own public profile ------------------------------------------
//
// The same card other people get, with the editing under it. A preview built
// from its own code would drift from the real thing, and seeing what they see
// is the entire point.

function frRenderMyProfile(tok) {
	frBody('<div class="profileLoading">Loading…</div>', tok)
	Promise.all([
		friendsProfile(authUser.id),
		friendsPrivacyGet(),
		friendsRoleOptions()
	]).then(function (all) {
		var p = all[0], s = all[1], roleOpts = all[2]
		var o = ''

		o += '<div class="frPrivHead">&#128065; How others see you</div>'
		if (p === null) {
			o += '<div class="profileNote profileWarn">Your profile is hidden, so nobody can see it. Turn <b>My profile</b> back on under Privacy.</div>'
		} else {
			o += '<div class="frPreview">' + frProfileBodyHtml(p) + '</div>'
		}

		o += '<div class="frPrivHead">&#127917; What are you into?</div>'
		o += '<div class="profileNote">Pick up to five. They show on your profile.</div>'
		o += '<div class="frRoleGrid">'
		var mine = (s.roles || [])
		for (var i = 0; i < roleOpts.length; i++) {
			var r = roleOpts[i]
			var on = mine.indexOf(r.key) > -1
			o += '<button class="frRole' + (on ? ' frRoleOn' : '') + '" onclick="frToggleRole(&quot;' + r.key + '&quot;)">'
			o += r.emoji + ' ' + authEsc(r.label) + '</button>'
		}
		o += '</div>'

		o += '<div class="frPrivHead">&#128302; Favourite cyphers</div>'
		o += '<div class="profileNote">Up to four, shown in their own colours. Picked from the cyphers you have switched on.</div>'
		o += '<div class="frFavRow">' + frFavPickerHtml(s.fav_ciphers || []) + '</div>'

		frBody(o, tok)
	}).catch(function (err) { frBody(profileErr(err), tok) })
}

function frToggleRole(key) {
	friendsPrivacyGet().then(function (s) {
		var mine = (s.roles || []).slice()
		var at = mine.indexOf(key)
		if (at > -1) mine.splice(at, 1)
		else {
			if (mine.length >= 5) { displayCalcNotification("Five at most — take one off first", 2400); return null }
			mine.push(key)
		}
		return friendsPrivacySet({ roles: mine })
	}).then(function (done) {
		if (done === null) return
		frRenderMyProfile(profileRenderSeq)
	}).catch(function (err) { displayCalcNotification(err.message || "Could not save", 2600) })
}

// Offered from the cyphers that are switched on, because those are the ones
// whose colours the profile can actually draw.
function frFavPickerHtml(current) {
	var o = ''
	for (var i = 0; i < current.length; i++) {
		var col = (typeof profileCipherColor === "function") ? profileCipherColor(current[i]) : null
		o += '<span class="frFav"' + (col ? ' style="color:' + col + ';border-color:' + col + '"' : '') + '>'
		o += authEsc(current[i])
		o += '<span class="frFavX" title="Remove" onclick="frRemoveFav(&quot;' + authEsc(current[i]).replace(/"/g, '&quot;') + '&quot;)">&#215;</span>'
		o += '</span>'
	}
	if (current.length < 4) {
		o += '<select class="frSelect frFavAdd" onchange="frAddFav(this.value); this.selectedIndex = 0;">'
		o += '<option value="">+ Add a cypher…</option>'
		if (typeof cipherList !== "undefined") {
			for (var c = 0; c < cipherList.length; c++) {
				if (!cipherList[c].enabled) continue
				if (current.indexOf(cipherList[c].cipherName) > -1) continue
				o += '<option value="' + authEsc(cipherList[c].cipherName) + '">' + authEsc(cipherList[c].cipherName) + '</option>'
			}
		}
		o += '</select>'
	} else {
		o += '<span class="profileWhen">Four is the limit</span>'
	}
	return o
}

function frAddFav(name) {
	if (!name) return
	friendsPrivacyGet().then(function (s) {
		var mine = (s.fav_ciphers || []).slice()
		if (mine.indexOf(name) > -1 || mine.length >= 4) return null
		mine.push(name)
		return friendsPrivacySet({ fav_ciphers: mine })
	}).then(function (done) {
		if (done === null) return
		frRenderMyProfile(profileRenderSeq)
	}).catch(function (err) { displayCalcNotification(err.message || "Could not save", 2600) })
}

function frRemoveFav(name) {
	friendsPrivacyGet().then(function (s) {
		var mine = (s.fav_ciphers || []).filter(function (n) { return n !== name })
		return friendsPrivacySet({ fav_ciphers: mine })
	}).then(function () {
		frRenderMyProfile(profileRenderSeq)
	}).catch(function (err) { displayCalcNotification(err.message || "Could not save", 2600) })
}

// ---- the tab's own badge ----------------------------------------------
//
// Shown on the Friends tab button in the row above, so an incoming request is
// visible without opening the tab.

function friendsRefreshBadge() {
	var counts = friendsBadgeCache.counts
	if (!counts) return
	var btn = document.getElementById("profileTabFriends")
	if (btn === null) return
	var n = frNewsTotal(counts)
	btn.value = n > 0 ? "📧 Friends (" + (n > 99 ? "99+" : n) + ")" : "📧 Friends"
	btn.classList.toggle("profileTabAlert", n > 0)
}

// ---- chats ------------------------------------------------------------
//
// Two views: the list of conversations, and one conversation. The second takes
// over the whole tab rather than sitting inside it, because a chat wants the
// height and the panel does not have much to spare.

function frRenderChats(tok) {
	frBody('<div class="profileLoading">Loading…</div>', tok)
	chatThreads().then(function (rows) {
		chatUnreadInvalidate()
		var o = ''
		if (!rows.length) {
			o += '<div class="profileNote">No conversations yet. Open <b>Friends</b> and press Message on someone.</div>'
			frBody(o, tok); return
		}
		o += '<div class="profileList">'
		for (var i = 0; i < rows.length; i++) {
			var r = rows[i]
			o += '<div class="profileRow frRow" onclick="frOpenChat(&quot;' + r.friend_id + '&quot;)">'
			o += frAvatar({ avatar: r.avatar, display_name: r.display_name })
			o += '<span class="frWho">'
			o += '<span class="frName">' + authEsc(r.display_name) + frAdminBadge(r.friend_id) + '</span>'
			// the preview is escaped like the message itself: a thread list is
			// no place for the one bit of unescaped text in the app
			o += '<span class="frSub frPreview">' + (r.last_body ? authEsc(r.last_body) : "no messages yet") + '</span>'
			o += '</span>'
			o += '<span class="profileRowActions frActions">'
			if (r.unread > 0) o += '<span class="frBadge">' + r.unread + '</span>'
			o += '<span class="profileWhen">' + frWhen(r.last_at) + '</span>'
			o += '</span></div>'
		}
		o += '</div>'
		frBody(o, tok)
	}).catch(function (err) { frBody(profileErr(err), tok) })
}

function frOpenChat(id) {
	chatOpenWith = id
	friendsViewing = null
	renderProfileFriends()
}

function frCloseChat() {
	chatOpenWith = null
	frStopChatPoll()
	friendsSection = "chats"
	chatUnreadInvalidate()
	renderProfileFriends()
}

function frRenderChatWindow(id, tok) {
	profileBody('<div class="profileLoading">Loading…</div>', tok)
	Promise.all([friendsProfile(id), chatHistory(id, 100)]).then(function (both) {
		var who = both[0], msgs = both[1]
		var name = who ? who.display_name : "Conversation"

		var o = '<div class="frChatHead">'
		o += '<button class="profileMiniBtn" onclick="frCloseChat()">&larr; Back</button>'
		o += '<span class="frChatWho">' + authEsc(name) + frAdminBadge(id) + (who ? frOnlineDot(who) : '') + '</span>'
		o += '<span class="frChatHeadActions">'
		o += '<button class="profileMiniBtn" onclick="frReportPrompt(this,&quot;' + id + '&quot;)" title="Report this member">Report</button>'
		o += '<button class="profileMiniBtn profileMiniDanger" onclick="frBlockMember(this,&quot;' + id + '&quot;)" title="Block: they can no longer message you, ask to be friends, or find you">Block</button>'
		o += '</span></div>'

		o += '<div id="frChatLog" class="frChatLog">' + frChatLogHtml(msgs) + '</div>'

		o += '<div class="frChatCompose">'
		o += '<textarea id="frChatBox" class="frChatBox" rows="2" maxlength="' + CHAT_MAX_LEN + '" '
		o += 'placeholder="Say something…" oninput="frChatTyping()" onkeydown="frChatKey(event)"></textarea>'
		o += '<button class="profileMiniBtn frChatSend" id="frChatSendBtn" onclick="frChatSend()">Send</button>'
		o += '</div>'
		o += '<div id="frChatWarn" class="frChatWarn"></div>'
		o += '<div class="profileNote profileFoot">Text and emoji only. Links, contact details and personal information are blocked, and messages are checked before they send.</div>'

		profileBody(o, tok)
		frChatScrollDown()
		chatMarkRead(id).catch(function () {})
		frStartChatPoll(id)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

function frChatLogHtml(msgs) {
	if (!msgs.length) return '<div class="profileNote">Nothing here yet. Say hello.</div>'
	var o = ''
	for (var i = 0; i < msgs.length; i++) {
		var m = msgs[i]
		o += '<div class="frMsgRow' + (m.mine ? ' frMsgMine' : '') + '">'
		o += '<div class="frBubble">' + chatRenderBody(m.body) + '</div>'
		o += '<div class="frMsgWhen">' + frWhen(m.created_at)
		// reporting the message rather than the person: a moderator judging
		// "they were rude" with no idea which line cannot judge anything
		if (!m.mine) {
			o += ' <span class="frMsgFlag" title="Report this message" onclick="frReportMessage(this,&quot;' +
				m.sender_id + '&quot;,&quot;' + m.id + '&quot;)">&#9873;</span>'
		}
		o += '</div>'
		o += '</div>'
	}
	return o
}

function frChatScrollDown() {
	var log = document.getElementById("frChatLog")
	if (log !== null) log.scrollTop = log.scrollHeight
}

// Enter sends, shift-Enter makes a line break. Line breaks are allowed, so
// there has to be a way to type one.
function frChatKey(e) {
	if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); frChatSend() }
}

// Warn as they type rather than only on send, for the rules a person trips by
// accident - a pasted link, a phone number - so it never gets as far as a
// refusal.
function frChatTyping() {
	var box = document.getElementById("frChatBox")
	var warn = document.getElementById("frChatWarn")
	if (box === null || warn === null) return
	var v = box.value
	if (v.trim() === "") { warn.textContent = ""; warn.className = "frChatWarn"; return }
	var pre = chatPrecheck(v)
	if (pre.ok) {
		var left = CHAT_MAX_LEN - v.length
		warn.textContent = left <= 60 ? left + " characters left" : ""
		warn.className = "frChatWarn"
	} else {
		warn.textContent = pre.why
		warn.className = "frChatWarn frChatWarnBad"
	}
}

function frChatSend() {
	var box = document.getElementById("frChatBox")
	var btn = document.getElementById("frChatSendBtn")
	if (box === null || chatOpenWith === null) return
	var body = box.value
	if (body.trim() === "") return

	btn.disabled = true
	chatSend(chatOpenWith, body).then(function () {
		box.value = ""
		frChatTyping()
		btn.disabled = false
		return chatHistory(chatOpenWith, 100)
	}).then(function (msgs) {
		var log = document.getElementById("frChatLog")
		if (log !== null) { log.innerHTML = frChatLogHtml(msgs); frChatScrollDown() }
	}).catch(function (err) {
		btn.disabled = false
		var warn = document.getElementById("frChatWarn")
		if (warn !== null) {
			warn.textContent = err.message || "Not sent"
			warn.className = "frChatWarn frChatWarnBad"
		}
		// the message stays in the box: they wrote it, and losing it because a
		// rule fired would be a second punishment for the same thing
	})
}

// Polling rather than a realtime subscription: a chat this quiet does not
// justify a socket, and a poll cannot get stuck in a state that needs a reload
// to clear.
function frStartChatPoll(id) {
	frStopChatPoll()
	chatPollTimer = setInterval(function () {
		if (chatOpenWith !== id) { frStopChatPoll(); return }
		chatHistory(id, 100).then(function (msgs) {
			var log = document.getElementById("frChatLog")
			if (log === null) { frStopChatPoll(); return }
			var atBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 40
			var next = frChatLogHtml(msgs)
			if (next !== log.innerHTML) {
				log.innerHTML = next
				if (atBottom) frChatScrollDown() // do not yank them away from what they are reading
				chatMarkRead(id).catch(function () {})
			}
		}).catch(function () { frStopChatPoll() })
	}, 6000)
}

function frStopChatPoll() {
	if (chatPollTimer !== null) { clearInterval(chatPollTimer); chatPollTimer = null }
}

// ---- report and block -------------------------------------------------

function frReportPrompt(btn, id) {
	if (!profileConfirmClick(btn, "Report?")) return
	chatReport(id, "chat", null).then(function () {
		displayCalcNotification("Reported. Thank you — we read every one.", 2600)
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not report", 2600)
	})
}

function frBlockMember(btn, id) {
	if (!profileConfirmClick(btn, "Block?")) return
	chatBlock(id).then(function () {
		displayCalcNotification("Blocked. They can no longer contact or find you.", 2800)
		friendsBadgeInvalidate()
		chatUnreadInvalidate()
		frCloseChat()
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not block", 2600)
	})
}

// ---- administrator badge ----------------------------------------------
//
// Drawn from a cached list of admin ids rather than a column on every query,
// so a name can be decorated wherever it appears without changing the shape of
// whatever fetched it. Silent if admin.js is not loaded.

function frAdminBadge(id) {
	return (typeof adminBadgeHtml === "function") ? adminBadgeHtml(id) : ""
}

// Report one message. The id goes with it, so the panel can show the
// conversation around it instead of a bare accusation.
function frReportMessage(el, senderId, messageId) {
	if (typeof chatReport !== "function") return
	if (el.dataset.armed !== "1") {
		el.dataset.armed = "1"
		el.classList.add("frMsgFlagArmed")
		el.title = "Click again to report"
		setTimeout(function () {
			el.dataset.armed = ""
			el.classList.remove("frMsgFlagArmed")
			el.title = "Report this message"
		}, 4000)
		return
	}
	el.dataset.armed = ""
	el.classList.remove("frMsgFlagArmed")
	chatReport(senderId, "chat message", null, messageId).then(function () {
		displayCalcNotification("Reported. Thank you — an administrator will look at it.", 2800)
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not report", 2600)
	})
}

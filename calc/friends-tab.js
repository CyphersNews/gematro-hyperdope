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
		o += '<div class="frTabs">'
		o += frSectionBtn("friends", "Friends", counts.friends)
		o += frSectionBtn("requests", "Requests", counts.incoming)
		o += frSectionBtn("chats", "Chats", chatUnreadCache.n)
		o += frSectionBtn("discover", "Discover", 0)
		o += frSectionBtn("privacy", "Privacy", 0)
		o += '</div>'
		o += '<div id="frBody"></div>'
		profileBody(o, tok)
		friendsRefreshBadge()

		if (friendsSection === "requests") frRenderRequests(tok, counts)
		else if (friendsSection === "chats") frRenderChats(tok)
		else if (friendsSection === "discover") frRenderDiscover(tok)
		else if (friendsSection === "privacy") frRenderPrivacy(tok)
		else frRenderFriends(tok)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

function frSectionBtn(id, label, badge) {
	var on = (friendsSection === id) ? " frTabOn" : ""
	var o = '<button class="intBtn3 frTab' + on + '" onclick="frSetSection(&quot;' + id + '&quot;)">' + label
	if (badge > 0) o += '<span class="frBadge">' + badge + '</span>'
	o += '</button>'
	return o
}

function frSetSection(id) {
	friendsSection = id
	friendsViewing = null
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
	o += '<span class="frName">' + authEsc(row.display_name) + frOnlineDot(row) + '</span>'
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
		o += '<div class="frToolbar">'
		o += '<span class="frToolLab">Sort</span>'
		o += frSortBtn("recent", "Recently added")
		o += frSortBtn("name", "A–Z")
		o += frSortBtn("online", "Online first")
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

function frSortBtn(id, label) {
	var on = (friendsSort === id) ? " frChipOn" : ""
	return '<button class="intBtn3 frChip' + on + '" onclick="frSetSort(&quot;' + id + '&quot;)">' + label + '</button>'
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
	friendsProfile(id).then(function (p) {
		if (p === null) {
			profileBody('<div class="frBack"><button class="profileMiniBtn" onclick="frCloseProfile()">&larr; Back</button></div>' +
				'<div class="profileNote">That profile is private.</div>', tok)
			return
		}

		var o = '<div class="frBack"><button class="profileMiniBtn" onclick="frCloseProfile()">&larr; Back</button></div>'
		o += '<div class="frProfile">'
		o += '<div class="frProfileHead">'
		o += frAvatar(p).replace("frAvatar", "frAvatar frAvatarBig")
		o += '<div class="frProfileWho">'
		o += '<div class="frProfileName">' + authEsc(p.display_name) + frOnlineDot(p) + '</div>'
		if (p.username && p.username !== p.display_name) o += '<div class="frSub">@' + authEsc(p.username) + '</div>'
		o += '<div class="frSub">Joined ' + new Date(p.joined_at).toLocaleDateString() + '</div>'
		o += '</div>'
		o += '<div class="frProfileActions">' + frButtons(p, { state: p.state }) + '</div>'
		o += '</div>'

		o += '<div class="frStats">'
		o += frStat(p.rank ? "#" + p.rank : "—", "Leaderboard")
		o += frStat(p.submissions, p.submissions === 1 ? "Phrase published" : "Phrases published")
		o += frStat(p.ciphers_used, p.ciphers_used === 1 ? "Cypher used" : "Cyphers used")
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
		profileBody(o, tok)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
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
	friendsPrivacyGet().then(function (s) {
		var o = ''
		o += '<div class="frSectionTitle">Who can send you a friend request</div>'
		o += '<div class="frToolbar">'
		o += frPolicyBtn(s.friend_policy, "everyone", "Anyone")
		o += frPolicyBtn(s.friend_policy, "friends_of_friends", "Friends of friends")
		o += frPolicyBtn(s.friend_policy, "nobody", "Nobody")
		o += '</div>'
		// said plainly rather than shipping two buttons that do the same thing
		o += '<div class="profileNote">Everything here needs an account, so &ldquo;anyone&rdquo; already means any signed-in member.</div>'

		o += '<div class="frSectionTitle">What others can see</div>'
		o += frToggle("public_profile", s.public_profile, "Show my profile", "Off hides you from search and discovery entirely.")
		o += frToggle("show_online", s.show_online, "Show when I am online", "")
		o += frToggle("show_last_active", s.show_last_active, "Show when I was last active", "")
		o += frToggle("show_mutuals", s.show_mutuals, "Show mutual friends", "")

		o += '<div class="profileNote profileFoot">Your email is never shown to anyone, whatever these are set to.</div>'
		frBody(o, tok)
	}).catch(function (err) { frBody(profileErr(err), tok) })
}

function frPolicyBtn(current, value, label) {
	var on = (current === value || (value === "everyone" && current === "members")) ? " frChipOn" : ""
	return '<button class="intBtn3 frChip' + on + '" onclick="frSetPolicy(&quot;' + value + '&quot;)">' + label + '</button>'
}

function frSetPolicy(value) {
	friendsPrivacySet({ friend_policy: value }).then(function () {
		displayCalcNotification("Saved", 1400)
		frRenderPrivacy(profileRenderSeq)
	}).catch(function (err) { displayCalcNotification(err.message || "Could not save", 2600) })
}

function frToggle(key, value, label, hint) {
	var o = '<div class="frToggleRow">'
	o += '<label class="pcChk pcChkBox"><input type="checkbox"' + (value ? ' checked' : '') +
		' onchange="frSetToggle(&quot;' + key + '&quot;, this.checked)"> ' + label + '</label>'
	if (hint) o += '<div class="frToggleHint">' + hint + '</div>'
	o += '</div>'
	return o
}

function frSetToggle(key, on) {
	var patch = {}
	patch[key] = !!on
	friendsPrivacySet(patch).then(function () {
		displayCalcNotification("Saved", 1400)
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not save", 2600)
		frRenderPrivacy(profileRenderSeq)
	})
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
	var n = counts.incoming
	btn.value = n > 0 ? "📧 Friends (" + n + ")" : "📧 Friends"
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
			o += '<span class="frName">' + authEsc(r.display_name) + '</span>'
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
		o += '<span class="frChatWho">' + authEsc(name) + (who ? frOnlineDot(who) : '') + '</span>'
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
		o += '<div class="frMsgWhen">' + frWhen(m.created_at) + '</div>'
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

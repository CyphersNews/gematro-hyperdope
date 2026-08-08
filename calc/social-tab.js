// ======================= Social feed tab =======================
//
// A feed of decodes, not of days. You cannot type a post: you pick a phrase
// out of your own History Table, the cyphers come with it already worked out,
// and the only thing you write is why it is worth looking at.
//
// That is the whole design. A box you can type anything into becomes a feed of
// anything; one that can only carry a decode stays a feed of decodes.

var socialScope = "all"
var socialComposeOpen = false
var socialComposePhrase = null

var socialScopes = [
	["all",     "&#127760;", "Everyone"],
	["friends", "&#128101;", "Friends"],
	["top",     "&#11088;",  "Most liked"],
	["mine",    "&#129489;", "Mine"]
]

function renderProfileSocial() {
	var tok = profileRenderSeq
	socialFeed(socialScope, 40, 0).then(function (posts) {
		var o = ''

		o += '<div class="soBar">'
		for (var s = 0; s < socialScopes.length; s++) {
			var sc = socialScopes[s]
			o += '<button class="intBtn3 frChip' + (socialScope === sc[0] ? ' frChipOn' : '') + '" ' +
				'onclick="socialSetScope(&quot;' + sc[0] + '&quot;)">' + sc[1] + ' ' + sc[2] + '</button>'
		}
		o += '<button class="profileMiniBtn soShareBtn" onclick="socialToggleCompose()">' +
			(socialComposeOpen ? '&#215; Close' : '&#10133; Share a find') + '</button>'
		o += '</div>'

		o += '<div id="soCompose">' + (socialComposeOpen ? socialComposeHtml() : '') + '</div>'

		if (!posts.length) {
			o += '<div class="profileNote">' + socialEmptyWord() + '</div>'
			profileBody(o, tok); return
		}

		o += '<div class="soFeed">'
		for (var i = 0; i < posts.length; i++) o += socialPostHtml(posts[i])
		o += '</div>'
		profileBody(o, tok)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

function socialEmptyWord() {
	if (socialScope === "mine") return "You have not shared anything yet. Press <b>Share a find</b> and pick a phrase from your table."
	if (socialScope === "friends") return "None of your friends have shared a find yet."
	if (socialScope === "top") return "Nothing has been liked yet."
	return "Nothing here yet. Press <b>Share a find</b> and start it off."
}

function socialSetScope(s) { socialScope = s; renderProfileSocial() }

function socialToggleCompose() {
	socialComposeOpen = !socialComposeOpen
	socialComposePhrase = null
	renderProfileSocial()
}

// ---- one post ----------------------------------------------------------

function socialPostHtml(p) {
	var o = '<div class="soPost">'

	o += '<div class="soHead">'
	o += '<span class="soWho" onclick="socialOpenProfile(&quot;' + p.author_id + '&quot;)" title="See their profile">'
	o += frAvatar({ avatar: p.author_avatar, display_name: p.author_name })
	o += '<span class="soName">' + authEsc(p.author_name) + frAdminBadge(p.author_id) + '</span>'
	o += '</span>'
	o += '<span class="soWhen" title="' + authEsc(new Date(p.created_at).toLocaleString()) + '">&#128197; ' + frWhen(p.created_at) + '</span>'
	o += '</div>'

	// the finding itself: the phrase, then what it came to
	o += '<div class="soPhrase" onclick="profileUsePhrase(&quot;' + authEsc(p.phrase).replace(/"/g, '&quot;') + '&quot;, true)" '
	o += 'title="Send this phrase to the calculator">' + authEsc(p.phrase) + '</div>'

	o += '<div class="soReadings">'
	var readings = p.readings || []
	for (var r = 0; r < readings.length; r++) {
		var col = (typeof profileCipherColor === "function") ? profileCipherColor(readings[r].cipher) : null
		o += '<span class="soReading"' + (col ? ' style="border-color:' + col + '"' : '') + '>'
		o += '<span class="soCipher"' + (col ? ' style="color:' + col + '"' : '') + '>' + authEsc(readings[r].cipher) + '</span>'
		o += '<span class="soValue">' + authEsc(String(readings[r].value)) + '</span>'
		o += '</span>'
	}
	o += '</div>'

	if (p.caption) o += '<div class="soCaption">' + chatRenderBody(p.caption) + '</div>'

	o += '<div class="soFoot">'
	o += '<button class="soAct' + (p.liked ? ' soActOn' : '') + '" onclick="socialToggleLike(this,&quot;' + p.id + '&quot;,' + (p.liked ? 'true' : 'false') + ')">'
	o += '<span class="soHeart">' + (p.liked ? '&#10084;' : '&#9825;') + '</span> <span class="soLikes">' + p.likes + '</span></button>'
	// the two that are not built yet say so rather than looking broken
	o += '<button class="soAct soActSoon" disabled title="Comments are coming">&#128172; Comment</button>'
	o += '<button class="soAct soActSoon" disabled title="Sharing is coming">&#128257; Share</button>'
	if (p.mine) {
		o += '<button class="soAct soActDel" onclick="socialRemove(this,&quot;' + p.id + '&quot;)" title="Delete this post">&#128465;</button>'
	}
	o += '</div>'

	o += '</div>'
	return o
}

function socialOpenProfile(id) {
	// the Friends tab owns the profile view, so hand over to it rather than
	// building a second one that would drift
	profileTabActive = "friends"
	friendsSection = "discover"
	friendsViewing = id
	renderProfilePanel()
}

function socialToggleLike(btn, id, liked) {
	btn.disabled = true
	socialLike(id, !liked).then(function (n) {
		btn.disabled = false
		btn.classList.toggle("soActOn", !liked)
		btn.querySelector(".soHeart").innerHTML = !liked ? "&#10084;" : "&#9825;"
		btn.querySelector(".soLikes").textContent = n
		btn.setAttribute("onclick", 'socialToggleLike(this,"' + id + '",' + (!liked) + ')')
	}).catch(function (err) {
		btn.disabled = false
		displayCalcNotification(err.message || "Could not do that", 2400)
	})
}

function socialRemove(btn, id) {
	if (!profileConfirmClick(btn, "Delete?")) return
	socialDelete(id).then(function () {
		displayCalcNotification("Post removed", 1600)
		renderProfileSocial()
	}).catch(function (err) { displayCalcNotification(err.message || "Could not delete", 2400) })
}

// ---- sharing a find ----------------------------------------------------

function socialComposeHtml() {
	var phrases = socialSharablePhrases()
	var o = '<div class="soCompose">'

	if (!phrases.length) {
		o += '<div class="profileNote">Your History Table is empty. Work something out in the calculator first &mdash; a post is a row of your own table, not a status update.</div>'
		return o + '</div>'
	}

	o += '<div class="soComposeLab">&#128269; Which phrase?</div>'
	o += '<select class="frSelect soPhrasePick" onchange="socialPickPhrase(this.value)">'
	o += '<option value="">Pick one from your table…</option>'
	for (var i = 0; i < phrases.length; i++) {
		o += '<option value="' + authEsc(phrases[i]) + '"' + (socialComposePhrase === phrases[i] ? ' selected' : '') + '>'
		o += authEsc(phrases[i]) + '</option>'
	}
	o += '</select>'

	if (socialComposePhrase !== null) {
		var readings = socialReadingsFor(socialComposePhrase)
		o += '<div class="soComposeLab">&#128302; It reads</div>'
		if (!readings.length) {
			o += '<div class="profileNote profileWarn">None of your switched-on cyphers give that a number. Turn on a cypher that does.</div>'
		} else {
			o += '<div class="soReadings">'
			for (var r = 0; r < readings.length; r++) {
				var col = (typeof profileCipherColor === "function") ? profileCipherColor(readings[r].cipher) : null
				o += '<span class="soReading"' + (col ? ' style="border-color:' + col + '"' : '') + '>'
				o += '<span class="soCipher"' + (col ? ' style="color:' + col + '"' : '') + '>' + authEsc(readings[r].cipher) + '</span>'
				o += '<span class="soValue">' + readings[r].value + '</span></span>'
			}
			o += '</div>'
			o += '<div class="profileNote">These are the cyphers you have switched on. Change them in the Cyphers menu and this follows.</div>'
		}

		o += '<div class="soComposeLab">&#9997; Why is it interesting?</div>'
		o += '<textarea id="soCaption" class="frChatBox soCaption2" rows="2" maxlength="400" '
		o += 'placeholder="What made you look twice?" oninput="socialCaptionTyping()"></textarea>'
		o += '<div id="soWarn" class="frChatWarn"></div>'
		o += '<button class="profileMiniBtn frMsg soPostBtn" id="soPostBtn" onclick="socialSubmit()">Share it</button>'
	}

	o += '</div>'
	return o
}

function socialPickPhrase(v) {
	socialComposePhrase = v || null
	var host = document.getElementById("soCompose")
	if (host !== null) host.innerHTML = socialComposeHtml()
}

// The caption meets the same rules a message does, so it is worth saying so
// before they press the button rather than after.
function socialCaptionTyping() {
	var box = document.getElementById("soCaption")
	var warn = document.getElementById("soWarn")
	if (box === null || warn === null) return
	if (box.value.trim() === "") { warn.textContent = ""; warn.className = "frChatWarn"; return }
	var pre = (typeof chatPrecheck === "function") ? chatPrecheck(box.value) : { ok: true }
	warn.textContent = pre.ok ? "" : pre.why
	warn.className = "frChatWarn" + (pre.ok ? "" : " frChatWarnBad")
}

function socialSubmit() {
	var btn = document.getElementById("soPostBtn")
	var box = document.getElementById("soCaption")
	if (socialComposePhrase === null) return
	var readings = socialReadingsFor(socialComposePhrase)
	if (!readings.length) { displayCalcNotification("Turn on a cypher that gives it a number", 2600); return }

	btn.disabled = true
	socialPost(socialComposePhrase, readings, box ? box.value : null).then(function () {
		displayCalcNotification("Shared", 1600)
		socialComposeOpen = false
		socialComposePhrase = null
		socialScope = "all"
		renderProfileSocial()
	}).catch(function (err) {
		btn.disabled = false
		var warn = document.getElementById("soWarn")
		if (warn !== null) {
			warn.textContent = err.message || "Not shared"
			warn.className = "frChatWarn frChatWarnBad"
		}
	})
}

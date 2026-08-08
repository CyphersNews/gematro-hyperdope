// ======================= First-run onboarding =======================
//
// Shown once, on the welcome page, to an account that has never been through
// it. Its job is the settings a new member would otherwise never find: who may
// send them a friend request, and what a stranger can see about them.
//
// Every step writes as it is answered rather than at the end. Someone who
// closes the tab half way through keeps the choices they made, and the
// defaults stand for the rest - so there is no state to lose and no "are you
// sure you want to leave".
//
// It depends on auth.js alone. authProfile already holds the whole row, and
// updateProfile() is the same column-restricted write the Privacy panel uses,
// so nothing here can set a field a member is not allowed to set.

var obStep = 0
var obSteps = ["welcome", "name", "requests", "visible", "done"]

function obShouldRun() {
	return !!(authProfile && authProfile.setup_done === false)
}

function obStart() {
	obStep = 0
	obRender()
}

function obGet(key, fallback) {
	if (!authProfile || authProfile[key] === undefined || authProfile[key] === null) return fallback
	return authProfile[key]
}

// ---- frame -------------------------------------------------------------

function obRender() {
	$("#obBack, #obBox").remove()

	var o = '<div id="obBack" class="obBack"></div>'
	o += '<div id="obBox" class="obBox">'

	o += '<div class="obDots">'
	for (var i = 0; i < obSteps.length; i++) {
		o += '<span class="obDot' + (i === obStep ? ' obDotOn' : (i < obStep ? ' obDotDone' : '')) + '"></span>'
	}
	o += '</div>'

	o += '<div class="obBody">' + obStepHtml() + '</div>'

	o += '<div class="obNav">'
	if (obStep > 0 && obStep < obSteps.length - 1) {
		o += '<button class="authBtn obBtnBack" type="button" onclick="obGo(-1)">&#8592; Back</button>'
	}
	if (obStep < obSteps.length - 1) {
		// Skip is deliberately as easy to reach as Next. A walkthrough you cannot
		// leave is a gate, and the defaults are already the cautious ones.
		o += '<button class="authBtn obBtnSkip" type="button" onclick="obFinish()">Skip</button>'
		o += '<button class="authBtn authBtnPrimary" type="button" onclick="obNext()">' +
			(obStep === 0 ? 'Start &#8594;' : 'Next &#8594;') + '</button>'
	} else {
		o += '<button class="authBtn authBtnPrimary obBtnWide" type="button" onclick="obFinish()">Take me to the calculator</button>'
	}
	o += '</div>'

	o += '</div>'
	$(o).appendTo("body")
}

function obGo(d) {
	obStep = Math.max(0, Math.min(obSteps.length - 1, obStep + d))
	obRender()
}

function obNext() {
	if (obSteps[obStep] === "name" && !obSaveName()) return
	obGo(1)
}

// Marks the account as seen and hands over to the calculator. setup_done is
// written on sight at the start rather than here, so a member who closes the
// tab is not sent back through this on their next visit.
function obFinish() {
	$("#obBack, #obBox").remove()
	window.location.replace("index.html")
}

// ---- steps -------------------------------------------------------------

function obStepHtml() {
	var s = obSteps[obStep]
	if (s === "welcome")  return obWelcomeHtml()
	if (s === "name")     return obNameHtml()
	if (s === "requests") return obRequestsHtml()
	if (s === "visible")  return obVisibleHtml()
	return obDoneHtml()
}

function obWelcomeHtml() {
	var o = '<div class="obIcon">&#128075;</div>'
	o += '<div class="obTitle">Welcome to Cyphers</div>'
	o += '<div class="obLead">Four quick questions, about a minute. They set who can reach you and what other members can see &mdash; the two things worth deciding before anyone finds you.</div>'
	o += '<div class="obNote">Everything here can be changed later in <b>Membership &rarr; Friends &rarr; Privacy</b>.</div>'
	return o
}

function obNameHtml() {
	var o = '<div class="obIcon">&#9997;</div>'
	o += '<div class="obTitle">What should we call you?</div>'
	o += '<div class="obLead">This is shown instead of your email, everywhere on the site.</div>'
	o += '<div class="authField authNameField obField">'
	o += '<input class="authInput" type="text" id="obName" maxlength="32" autocomplete="nickname" ' +
		'placeholder="Your display name" value="' + authEsc(obGet("username", "")) + '">'
	o += '<div id="obNameErr" class="authFieldErr hideValue"></div>'
	o += '<div class="authHint">2&ndash;32 characters. Letters, numbers, spaces, dots and dashes.</div>'
	o += '</div>'
	o += '<div class="obNote">Leave it empty and we will use the first part of your email.</div>'
	return o
}

function obSaveName() {
	var box = document.getElementById("obName")
	if (box === null) return true
	var name = box.value.trim()

	// the same rules the profile form applies, so the two cannot disagree
	if (name.length > 0 && (name.length < 2 || name.length > 32)) return obNameErr("Use between 2 and 32 characters.")
	if (name.length > 0 && !/^[\w .\-]+$/.test(name)) return obNameErr("Letters, numbers, spaces, dots and dashes only.")
	if (name === (obGet("username", "") || "")) return true

	updateProfile({ username: name === "" ? null : name }).catch(function (err) {
		var m = (err.message || "").toLowerCase()
		obNameErr(m.indexOf("duplicate") > -1 || m.indexOf("unique") > -1
			? "That display name is already taken."
			: "Could not save that name.")
		obStep = 1
		obRender()
	})
	return true
}

function obNameErr(msg) {
	var el = document.getElementById("obNameErr")
	if (el !== null) { el.textContent = msg; el.classList.remove("hideValue") }
	return false
}

function obRequestsHtml() {
	var cur = obGet("friend_policy", "everyone")
	var o = '<div class="obIcon">&#128274;</div>'
	o += '<div class="obTitle">Who can send you a friend request?</div>'
	o += '<div class="obLead">Nobody can message you until you are friends, so this is the only door.</div>'
	o += obCard(cur, "everyone", "&#127758;", "Anyone",
		"Any member can ask. You still choose whether to accept.")
	o += obCard(cur, "friends_of_friends", "&#128101;", "Friends of friends",
		"Only people who already know someone you know.")
	o += obCard(cur, "nobody", "&#128275;", "Nobody for now",
		"You can still send requests yourself.")
	return o
}

function obCard(current, value, icon, title, blurb) {
	// "members" is the older name for "everyone"; a row set to either lights the
	// same card, matching what the Privacy panel does
	var on = (current === value || (value === "everyone" && current === "members"))
	var o = '<button class="frChoiceCard' + (on ? ' frChoiceOn' : '') + '" type="button" onclick="obSetPolicy(&quot;' + value + '&quot;)">'
	o += '<span class="frChoiceIcon">' + icon + '</span>'
	o += '<span class="frChoiceBody"><span class="frChoiceTitle">' + title + '</span>'
	o += '<span class="frChoiceBlurb">' + blurb + '</span></span>'
	o += '<span class="frChoiceTick">' + (on ? '&#10003;' : '') + '</span>'
	o += '</button>'
	return o
}

function obSetPolicy(v) {
	updateProfile({ friend_policy: v }).catch(function () {})
	if (authProfile) authProfile.friend_policy = v // paint now, do not wait on the round trip
	obRender()
}

function obVisibleHtml() {
	var o = '<div class="obIcon">&#128065;</div>'
	o += '<div class="obTitle">What can others see?</div>'
	o += '<div class="obLead">Tap any of these to change it. Your email is never shown to anyone, whatever you choose here.</div>'
	o += obSwitch("public_profile", obGet("public_profile", true), "&#127760;", "My profile",
		"Lets other members open your profile and find you in Discover.")
	o += obSwitch("show_online", obGet("show_online", true), "&#128994;", "When I am online", "")
	o += obSwitch("show_last_active", obGet("show_last_active", true), "&#128338;", "When I was last active", "")
	o += obSwitch("show_mutuals", obGet("show_mutuals", true), "&#129309;", "Friends we have in common", "")
	o += obSwitch("show_friend_count", obGet("show_friend_count", true), "&#128101;", "How many friends I have", "")
	return o
}

function obSwitch(key, value, icon, title, blurb) {
	var o = '<div class="frSwitchRow' + (value ? ' frSwitchOn' : '') + '" onclick="obToggle(this,&quot;' + key + '&quot;)">'
	o += '<span class="frSwitchIcon">' + icon + '</span>'
	o += '<span class="frSwitchBody"><span class="frSwitchTitle">' + title + '</span>'
	if (blurb) o += '<span class="frSwitchBlurb">' + blurb + '</span>'
	o += '</span>'
	o += '<span class="frSwitch" role="switch" aria-checked="' + (value ? 'true' : 'false') + '"><span class="frSwitchKnob"></span></span>'
	o += '</div>'
	return o
}

function obToggle(row, key) {
	var on = !row.classList.contains("frSwitchOn")
	row.classList.toggle("frSwitchOn", on)
	var sw = row.querySelector(".frSwitch")
	if (sw !== null) sw.setAttribute("aria-checked", on ? "true" : "false")
	if (authProfile) authProfile[key] = on

	var patch = {}
	patch[key] = on
	updateProfile(patch).catch(function () {
		// put it back rather than leave the switch claiming something untrue
		row.classList.toggle("frSwitchOn", !on)
		if (sw !== null) sw.setAttribute("aria-checked", !on ? "true" : "false")
		if (authProfile) authProfile[key] = !on
	})
}

function obDoneHtml() {
	var o = '<div class="obIcon">&#127881;</div>'
	o += '<div class="obTitle">That is you set up</div>'
	o += '<div class="obLead">A few things worth knowing:</div>'
	o += '<div class="obList">'
	o += obPoint("&#128302;", "Everything saves itself", "Signed in, your history, presets and workspace follow you between devices.")
	o += obPoint("&#128101;", "Friends first, then chat", "You can only message somebody you are friends with, and either of you can undo that at any time.")
	o += obPoint("&#128681;", "Report anything", "Every message has a flag on it. An administrator reads every report.")
	o += '</div>'
	o += '<div class="obNote">Change any of these settings under <b>Membership &rarr; Friends &rarr; Privacy</b>.</div>'
	return o
}

function obPoint(icon, title, blurb) {
	return '<div class="obPoint"><span class="obPointIcon">' + icon + '</span>' +
		'<span class="obPointBody"><span class="obPointTitle">' + title + '</span>' +
		'<span class="obPointBlurb">' + blurb + '</span></span></div>'
}

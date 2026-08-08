// ======================= Matching page =======================
//
// One page with four states, in order of what is blocking the member:
//
//   closed     the master flag is off - nobody gets in, including subscribers
//   locked     the paywall is on and they have not paid
//   setup      they are through the gate but have not told us anything yet
//   matches    the list
//
// Each state answers the same question - "why am I not looking at matches" -
// and each one ends with the single next thing to do. Nothing is hidden behind
// a disabled button with no explanation.
//
// The tone is deliberate. This is a compatibility feature on a gematria site,
// not a dating app: there are no photos larger than an avatar, no swiping, no
// "X people viewed you", and no score is ever shown to the person it is about.
// Two members see the same number about each other, and it is about the
// numbers they were both already interested in.

var mStatus = null      // match_status() row
var mProfile = null     // user_birth_data row
var mCiphers = null     // user_cypher_preferences row
var mMatches = null
var mForm = null        // the birth form being edited
var mPickedCiphers = null
var mSetupOpen = false

// ---- shell -------------------------------------------------------------

// Which of the four the member is in. Worked out once and acted on twice -
// once to build the markup, once to fill it in - because deciding separately
// in each place is how a setup form ends up being painted into a paywall.
function matchState() {
	if (!flagEnabled("matching_enabled") || (mStatus && !mStatus.enabled)) return "closed"
	if (matchIsLocked()) return "locked"
	if (!mStatus || !mStatus.has_birth_data || !mStatus.opted_in || mSetupOpen) return "setup"
	return "matches"
}

// Stripe redirects back with ?checkout=success, and the webhook that unlocks
// the account is a separate network call that may not have landed yet. Polling
// briefly is better than either lying ("you're in!") or telling somebody who
// just paid that they have not.
function matchCheckoutReturn() {
	var q = new URLSearchParams(window.location.search).get("checkout")
	if (!q) return false
	// clear it so a refresh does not re-run this
	history.replaceState(null, "", window.location.pathname)

	if (q === "cancelled") {
		matchToast("Checkout cancelled — nothing was charged")
		return false
	}
	if (q !== "success") return false

	matchWrite(matchHeaderHtml() +
		'<div class="matchCard matchGate"><div class="matchGateGlyph">&#10022;</div>' +
		'<div class="matchGateTitle">Thank you</div>' +
		'<div class="matchGateLead">Stripe has taken the payment. Waiting for it to reach us &mdash; ' +
		'this is usually a second or two.</div></div>' +
		'<div id="matchToast" class="matchToast"></div>')

	var tries = 0
	var poll = setInterval(function () {
		tries++
		billingInvalidate()
		Promise.all([billingLoad(true), matchStatus()]).then(function (all) {
			mStatus = all[1]
			if (mStatus && mStatus.subscribed) {
				clearInterval(poll)
				matchRender()
				matchToast("You are in. Welcome to Matching.")
			} else if (tries >= 10) {
				clearInterval(poll)
				matchRender()
				matchToast("Payment received. If Matching is still locked in a minute, reload the page.", true)
			}
		}).catch(function () {
			if (tries >= 10) { clearInterval(poll); matchRender() }
		})
	}, 2000)
	return true
}

function matchRender(status) {
	if (status !== undefined) mStatus = status

	var state = matchState()
	var o = matchHeaderHtml()
	o += matchFreeBannerHtml()

	if (state === "closed")      o += matchClosedHtml()
	else if (state === "locked") o += matchLockedHtml()
	else if (state === "setup")  o += matchSetupHtml()
	else                         o += matchListHtml()

	o += '<div id="matchToast" class="matchToast"></div>'
	matchWrite(o)

	if (state === "setup")   matchFillForm()
	if (state === "matches" && mMatches === null) matchLoadList()
}

// The flag says whether there is a paywall; match_status() says whether this
// member is past it. Both have to be asked, because an administrator and a
// subscriber are past it for different reasons.
//
// mStatus.subscribed is the server's answer to "may they use Matching", which
// is already true under testing mode — so the locked state is unreachable while
// the flag is on without this function knowing anything extra. The flag check
// below is belt and braces for the window before match_status() has answered.
function matchIsLocked() {
	if (!mStatus) return false
	if (matchIsFree()) return false
	return mStatus.requires_payment && !mStatus.subscribed
}

// Testing mode: everyone is in, and everyone should be told why. A member who
// silently gets a paid feature for nothing assumes it is free for ever, and is
// then surprised on launch day — which is a worse outcome than a banner.
function matchIsFree() {
	if (mStatus && typeof mStatus.force_free === "boolean") return mStatus.force_free
	return flagEnabled("matching_force_free")
}

// Is this member actually paying? Separate question from "may they use it",
// and the banner depends on the difference — somebody who really subscribed
// must not be told they are on a free trial.
function matchIsPaying() {
	if (mStatus && typeof mStatus.paying === "boolean") return mStatus.paying
	return !!(typeof billingState !== "undefined" && billingState && billingState.active)
}

// The banner. Sits above everything, on every state, because "this is free
// right now" is true of the setup form and the list alike.
function matchFreeBannerHtml() {
	if (!matchIsFree()) return ''
	var o = '<div class="matchTesting">'
	o += '<span class="matchTestingTag">Testing mode</span>'
	if (matchIsPaying()) {
		// They are paying AND the flag is on. Say so — the flag is not the
		// reason they are in, and implying otherwise misrepresents what they
		// are being charged for.
		o += '<span class="matchTestingText">Matching is free for everyone while we test. ' +
			'You have an active subscription as well &mdash; manage or cancel it any time from the ' +
			'billing portal.</span>'
	} else {
		o += '<span class="matchTestingText">Matching is free for everyone while we test &mdash; ' +
			'no subscription needed. It will not stay this way, so have a proper look around now.</span>'
		// Checkout stays reachable: it is still meant to be testable, and
		// somebody who wants to support the site early should be able to.
		o += '<button class="matchTestingLink" type="button" onclick="matchStartCheckout(this)">' +
			'Subscribe anyway</button>'
	}
	o += '</div>'
	return o
}

function matchHeaderHtml() {
	var sub = (typeof billingState !== "undefined" && billingState) ? billingState : null
	var o = '<div class="matchHead">'
	o += '<div class="matchTitleWrap">'
	o += '<div class="matchTitle">Matching</div>'
	o += '<div class="matchSub">Members whose chart and cyphers run close to yours.</div>'
	o += '</div>'
	// Only ever reports the BILLING state. Testing mode does not touch this —
	// a member let in by the flag is "Not subscribed", because they are, and a
	// pill that said otherwise would have them believe they are being charged.
	if (sub) {
		var on = !!sub.active
		o += '<div class="matchPill' + (on ? ' matchPillOn' : '') + '" title="' +
			authEsc(billingRenewsLine(sub) || "") + '">' + authEsc(billingStatusLabel(sub)) + '</div>'
	}
	o += '</div>'
	return o
}

function matchToast(msg, bad) {
	var el = document.getElementById("matchToast")
	if (el === null) return
	el.textContent = msg
	el.className = "matchToast matchToastShow" + (bad ? " matchToastBad" : "")
	clearTimeout(matchToast.t)
	matchToast.t = setTimeout(function () { el.className = "matchToast" }, 3400)
}

// ---- state: closed -----------------------------------------------------

function matchClosedHtml() {
	var o = '<div class="matchCard matchGate">'
	o += '<div class="matchGateGlyph">&#10022;</div>'
	o += '<div class="matchGateTitle">Coming soon &mdash; Paid Matching</div>'
	o += '<div class="matchGateLead">Matching is being built. When it opens you will be able to find members ' +
		'whose birth chart and cypher work line up with yours, ranked by how closely.</div>'
	o += matchFreeNoteHtml()
	o += '<a class="matchBtn matchBtnGhost" href="index.html">Back to the calculator</a>'
	o += '</div>'
	return o
}

// ---- state: locked -----------------------------------------------------

function matchLockedHtml() {
	var o = '<div class="matchCard matchGate">'
	o += '<div class="matchGateGlyph">&#10022;</div>'
	o += '<div class="matchGateTitle">Matching is the one paid feature</div>'
	o += '<div class="matchGateLead">Everything else on Cyphers is free and stays free. This is the part that ' +
		'costs, because it is the part that needs people rather than arithmetic.</div>'

	o += '<div class="matchWhat">'
	o += matchWhatRow("&#128302;", "Chart against chart",
		"Sun, Moon, Venus, Mars and the Ascendant, compared sign by sign.")
	o += matchWhatRow("&#128290;", "Your systems, not ours",
		"Ranked on the cyphers you actually work in, and what your phrase comes to in them.")
	o += matchWhatRow("&#129309;", "You choose who knows",
		"Nobody appears in matching without switching it on, and nobody ever sees your birth details.")
	o += '</div>'

	if (mStatus && mStatus.pool > 0) {
		o += '<div class="matchPool">' + mStatus.pool +
			(mStatus.pool === 1 ? ' member is' : ' members are') + ' in the pool right now.</div>'
	}

	o += '<div class="matchGateBtns">'
	o += '<button class="matchBtn matchBtnPrimary matchBtnBig" type="button" id="matchUpgrade" ' +
		'onclick="matchStartCheckout(this)">Subscribe to Matching</button>'
	// Only offer the portal to somebody who has actually been a customer.
	// "Manage subscription" in front of a person who never subscribed is a
	// dead end wearing a helpful label.
	if (typeof billingHasCustomer === "function" && billingHasCustomer()) {
		o += '<button class="matchBtn matchBtnGhost" type="button" onclick="matchOpenPortal(this)">' +
			'Manage subscription</button>'
	}
	o += '</div>'

	var sub = (typeof billingState !== "undefined" && billingState) ? billingState : null
	if (sub && sub.status === "past_due") {
		o += '<div class="matchGateNote matchGateWarn">Your last payment did not go through, so Matching is ' +
			'locked until it does. Update your card and it unlocks straight away &mdash; nothing has been lost.</div>'
	}

	o += '<div class="matchGateNote">Payment is handled by Stripe. Your card details go to them, never to us ' +
		'&mdash; we store a status and a renewal date and nothing else. Cancel any time; you keep access ' +
		'until the end of the period you have paid for.</div>'
	o += '<a class="matchBtn matchBtnGhost" href="index.html">Back to the calculator</a>'
	o += matchFreeNoteHtml()
	o += '</div>'
	return o
}

function matchStartCheckout(btn) {
	if (typeof billingCheckout !== "function") {
		matchToast("Subscriptions are not switched on yet", true); return
	}
	btn.disabled = true
	btn.textContent = "Opening Stripe…"
	billingCheckout().catch(function (err) {
		btn.disabled = false
		btn.textContent = "Subscribe to Matching"
		matchToast(err.message || "Could not start checkout", true)
	})
}

function matchOpenPortal(btn) {
	btn.disabled = true
	billingPortal().catch(function (err) {
		btn.disabled = false
		matchToast(err.message || "Could not open the billing portal", true)
	})
}

function matchWhatRow(glyph, title, blurb) {
	return '<div class="matchWhatRow"><span class="matchWhatGlyph">' + glyph + '</span>' +
		'<span class="matchWhatBody"><span class="matchWhatTitle">' + title + '</span>' +
		'<span class="matchWhatBlurb">' + blurb + '</span></span></div>'
}

function matchFreeNoteHtml() {
	return '<div class="matchFree">Free forever: the calculator, your profile, Discord linking, ' +
		'the leaderboard, friends, chat and the feed.</div>'
}

// ---- state: setup ------------------------------------------------------

function matchSetupHtml() {
	var o = ''

	if (mStatus && mStatus.has_birth_data && mStatus.opted_in) {
		o += '<div class="matchBar"><button class="matchBtn matchBtnGhost matchBtnSm" onclick="matchCloseSetup()">' +
			'&#8592; Back to matches</button></div>'
	} else {
		o += '<div class="matchSteps">'
		o += matchStepDot(1, "Birth details", !!(mStatus && mStatus.has_birth_data))
		o += matchStepDot(2, "Your cyphers", !!(mStatus && mStatus.cipher_count > 0))
		o += matchStepDot(3, "Switch it on", !!(mStatus && mStatus.opted_in))
		o += '</div>'
	}

	o += '<div class="matchCard">'
	o += '<div class="matchCardHead">&#127756; Birth details</div>'
	o += '<div class="matchNote">Used to work out your chart and nothing else. No other member can ever read ' +
		'these &mdash; matching compares the result and reports only what you have in common.</div>'
	o += '<div id="matchForm"></div>'
	o += '</div>'

	o += '<div class="matchCard">'
	o += '<div class="matchCardHead">&#128290; Your cyphers</div>'
	o += '<div class="matchNote">Pick the systems you work in and the phrase you want compared &mdash; ' +
		'usually your own name. Members who get the same number in the same system rank higher.</div>'
	o += '<div id="matchCipherPick"></div>'
	o += '</div>'

	o += '<div class="matchCard">'
	o += '<div class="matchCardHead">&#128274; Consent</div>'
	o += '<div id="matchConsent"></div>'
	o += '</div>'

	return o
}

function matchStepDot(n, label, done) {
	return '<div class="matchStep' + (done ? ' matchStepDone' : '') + '">' +
		'<span class="matchStepN">' + (done ? '&#10003;' : n) + '</span>' +
		'<span class="matchStepLab">' + label + '</span></div>'
}

// Painted after the shell so the three panels can be redrawn independently -
// picking a cypher should not reset a half-typed birth time.
function matchFillForm() {
	// A member who has already saved something must see it, not a blank form
	// with today's defaults in it - so fetch first when the status says there
	// is something to fetch and it is not in hand yet.
	var needsProfile = mProfile === null && mStatus && mStatus.has_birth_data
	var needsCiphers = mCiphers === null && mStatus && mStatus.cipher_count > 0
	if (!needsProfile && !needsCiphers) { matchPaintAll(); return }

	Promise.all([
		needsProfile ? matchProfileGet().catch(function () { return null }) : Promise.resolve(mProfile),
		needsCiphers ? matchCiphersGet().catch(function () { return null }) : Promise.resolve(mCiphers)
	]).then(function (both) {
		mProfile = both[0]
		mCiphers = both[1]
		mForm = null // rebuild it from what came back
		matchPaintAll()
	})
}

function matchPaintAll() {
	if (mForm === null) mForm = matchFormFromProfile(mProfile)
	matchPaintBirth()
	matchPaintCiphers()
	matchPaintConsent()
}

function matchFormFromProfile(p) {
	if (p) {
		var parts = String(p.birth_date).split("-")
		var t = p.birth_time ? String(p.birth_time).split(":") : null
		return {
			y: Number(parts[0]), m: Number(parts[1]), d: Number(parts[2]),
			hh: t ? Number(t[0]) : 12, mm: t ? Number(t[1]) : 0,
			timeKnown: !!p.birth_time,
			place: p.place_label || "", lat: p.latitude, lon: p.longitude,
			tz: p.tz_offset || 0, zodiac: p.zodiac || "tropical"
		}
	}
	var now = new Date()
	return {
		y: now.getFullYear() - 30, m: 1, d: 1, hh: 12, mm: 0, timeKnown: false,
		place: "", lat: 51.5074, lon: -0.1278, tz: 0, zodiac: "tropical"
	}
}

function matchPaintBirth() {
	var f = mForm
	var o = '<div class="matchGrid">'
	o += matchField("mY", "Year", f.y, "number")
	o += matchField("mM", "Month", f.m, "number")
	o += matchField("mD", "Day", f.d, "number")
	o += '</div>'

	o += '<label class="matchCheck" onclick="matchToggleTime(event)">'
	o += '<span class="matchBox' + (f.timeKnown ? '' : ' matchBoxOn') + '">' + (f.timeKnown ? '' : '&#10003;') + '</span>'
	o += '<span>I do not know my birth time</span></label>'

	if (f.timeKnown) {
		o += '<div class="matchGrid">'
		o += matchField("mHH", "Hour", f.hh, "number")
		o += matchField("mMM", "Minute", f.mm, "number")
		o += matchField("mTZ", "UTC offset", f.tz, "number")
		o += '</div>'
		o += '<div class="matchField">'
		o += '<label class="matchLabel" for="mPlace">Place of birth</label>'
		o += '<div class="matchLookup">'
		o += '<input class="matchInput" type="text" id="mPlace" value="' + authEsc(f.place) + '" placeholder="Town or city">'
		o += '<button class="matchBtn matchBtnSm" type="button" onclick="matchLookupPlace()">Look up</button>'
		o += '</div>'
		o += '<div id="mPlaceResults" class="matchResults"></div>'
		o += '</div>'
		o += '<div class="matchGrid">'
		o += matchField("mLat", "Latitude", f.lat, "number")
		o += matchField("mLon", "Longitude", f.lon, "number")
		o += '</div>'
		o += '<div class="matchHint">The Ascendant needs a time and a place. Without them your chart still ' +
			'matches on everything else &mdash; it just cannot use the rising sign.</div>'
	} else {
		o += '<div class="matchHint">Without a birth time the Moon is approximate and the Ascendant is left out ' +
			'entirely, rather than guessed. Everything else is accurate to a fraction of a degree.</div>'
	}

	o += '<div class="matchZodiac">'
	o += matchChip("tropical", "Tropical", f.zodiac !== "sidereal")
	o += matchChip("sidereal", "Sidereal", f.zodiac === "sidereal")
	o += '</div>'

	o += '<button class="matchBtn matchBtnPrimary" type="button" id="mSaveBirth" onclick="matchSaveBirth()">' +
		(mProfile ? 'Update my chart' : 'Work out my chart') + '</button>'
	o += '<div id="mBirthMsg" class="matchMsg"></div>'

	if (mProfile) o += matchSignatureHtml()

	document.getElementById("matchForm").innerHTML = o
}

// Shows the member their own signature, because a number computed about you
// that you cannot see is not something you can meaningfully consent to.
function matchSignatureHtml() {
	var names = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]
	var keys = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"]
	var o = '<div class="matchSig"><div class="matchSigHead">This is what will be compared</div>'
	o += '<div class="matchSigRow">'
	for (var i = 0; i < keys.length; i++) {
		var v = mProfile[keys[i] + "_sign"]
		if (v === null || v === undefined) continue
		o += '<span class="matchSigChip"><b>' + names[i] + '</b> ' + authEsc(matchSignName(v)) + '</span>'
	}
	if (mProfile.asc_sign !== null && mProfile.asc_sign !== undefined) {
		o += '<span class="matchSigChip"><b>Rising</b> ' + authEsc(matchSignName(mProfile.asc_sign)) + '</span>'
	}
	if (mProfile.life_path) {
		o += '<span class="matchSigChip matchSigLp"><b>Life Path</b> ' + mProfile.life_path + '</span>'
	}
	o += '</div></div>'
	return o
}

var MATCH_SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
	"Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]

function matchSignName(i) { return MATCH_SIGN_NAMES[i] || "—" }

function matchField(id, label, value, type) {
	return '<div class="matchField"><label class="matchLabel" for="' + id + '">' + label + '</label>' +
		'<input class="matchInput" type="' + (type || "text") + '" id="' + id + '" value="' +
		authEsc(value === null || value === undefined ? "" : value) + '" oninput="matchCapture()"></div>'
}

function matchChip(v, label, on) {
	return '<button class="matchChip' + (on ? ' matchChipOn' : '') + '" type="button" ' +
		'onclick="matchSetZodiac(&quot;' + v + '&quot;)">' + label + '</button>'
}

function matchNum(id, fallback) {
	var e = document.getElementById(id)
	if (e === null) return fallback
	var v = Number(e.value)
	return isFinite(v) ? v : fallback
}

function matchCapture() {
	var f = mForm
	f.y = matchNum("mY", f.y); f.m = matchNum("mM", f.m); f.d = matchNum("mD", f.d)
	f.hh = matchNum("mHH", f.hh); f.mm = matchNum("mMM", f.mm); f.tz = matchNum("mTZ", f.tz)
	f.lat = matchNum("mLat", f.lat); f.lon = matchNum("mLon", f.lon)
	var p = document.getElementById("mPlace")
	if (p !== null) f.place = p.value
	return f
}

function matchToggleTime(e) {
	if (e) e.preventDefault()
	matchCapture()
	mForm.timeKnown = !mForm.timeKnown
	matchPaintBirth()
}

function matchSetZodiac(z) { matchCapture(); mForm.zodiac = z; matchPaintBirth() }

function matchLookupPlace() {
	var box = document.getElementById("mPlace")
	var out = document.getElementById("mPlaceResults")
	if (box === null || out === null) return
	var q = box.value.trim()
	if (q === "") return
	out.innerHTML = '<div class="matchHint">Searching…</div>'
	fetch(astroGeoUrl(q), { headers: { "Accept": "application/json" } })
		.then(function (r) { return r.json() })
		.then(function (data) {
			var hits = astroGeoParse(data)
			if (!hits.length) { out.innerHTML = '<div class="matchHint">Nothing found.</div>'; return }
			matchGeoHits = hits
			var o = ''
			for (var i = 0; i < hits.length; i++) {
				o += '<button class="matchResult" type="button" onclick="matchPickPlace(' + i + ')">' +
					authEsc(hits[i].label) + '</button>'
			}
			out.innerHTML = o
		})
		.catch(function () { out.innerHTML = '<div class="matchHint">Could not reach the lookup service.</div>' })
}

var matchGeoHits = []

// Sets the offset as well as the coordinates. Leaving the offset behind is the
// bug that made a Brooklyn birth read as a London one - the coordinates moved
// and the clock did not, so every angle came out of the wrong hour.
function matchPickPlace(i) {
	var hit = matchGeoHits[i]
	if (!hit) return
	matchCapture()
	mForm.place = hit.label
	mForm.lat = hit.lat
	mForm.lon = hit.lon
	mForm.tz = Math.round(hit.lon / 15) // a first guess; the member can correct it
	matchPaintBirth()
	matchToast("Check the UTC offset — this is a guess from the longitude")
}

function matchSaveBirth() {
	var f = matchCapture()
	var msg = document.getElementById("mBirthMsg")
	var btn = document.getElementById("mSaveBirth")

	if (!isFinite(f.y) || f.y < 1901 || f.y > new Date().getFullYear()) return matchMsg(msg, "Check the year.", true)
	if (!(f.m >= 1 && f.m <= 12)) return matchMsg(msg, "Month runs 1 to 12.", true)
	if (!(f.d >= 1 && f.d <= 31)) return matchMsg(msg, "Day runs 1 to 31.", true)
	if (f.timeKnown && !(f.hh >= 0 && f.hh <= 23)) return matchMsg(msg, "Hour runs 0 to 23.", true)
	if (f.timeKnown && !(f.mm >= 0 && f.mm <= 59)) return matchMsg(msg, "Minute runs 0 to 59.", true)

	var sig = matchDeriveSignature(f)
	if (sig === null) return matchMsg(msg, "The chart engine did not load. Reload the page.", true)

	var row = {
		birth_date: matchPad(f.y, 4) + "-" + matchPad(f.m, 2) + "-" + matchPad(f.d, 2),
		birth_time: f.timeKnown ? (matchPad(f.hh, 2) + ":" + matchPad(f.mm, 2) + ":00") : null,
		place_label: f.timeKnown ? String(f.place || "").slice(0, 120) : "",
		latitude: f.timeKnown ? f.lat : null,
		longitude: f.timeKnown ? f.lon : null,
		tz_offset: f.timeKnown ? f.tz : 0,
		zodiac: sig.zodiac,
		sun_sign: sig.sun_sign, moon_sign: sig.moon_sign, mercury_sign: sig.mercury_sign,
		venus_sign: sig.venus_sign, mars_sign: sig.mars_sign,
		jupiter_sign: sig.jupiter_sign, saturn_sign: sig.saturn_sign,
		asc_sign: sig.asc_sign
	}
	// an existing opt-in survives an edit; a new row starts opted out
	if (mProfile) row.matching_opt_in = mProfile.matching_opt_in

	btn.disabled = true
	matchProfileSave(row).then(function (saved) {
		btn.disabled = false
		mProfile = saved
		mMatches = null
		// the toast, not the inline message: the panel is repainted a moment
		// later and would take an inline confirmation with it
		matchToast("Chart saved")
		return matchStatus()
	}).then(function (st) {
		mStatus = st
		matchPaintBirth()
		matchPaintConsent()
		matchRefreshSteps()
	}).catch(function (err) {
		btn.disabled = false
		matchMsg(msg, err.message || "Could not save", true)
	})
}

function matchPad(n, w) {
	var s = String(Math.abs(Math.round(Number(n))))
	while (s.length < w) s = "0" + s
	return s
}

function matchMsg(el, text, bad) {
	if (el === null) return false
	el.textContent = text
	el.className = "matchMsg matchMsgShow" + (bad ? " matchMsgBad" : " matchMsgOk")
	return false
}

// ---- cyphers -----------------------------------------------------------

function matchPaintCiphers() {
	var host = document.getElementById("matchCipherPick")
	if (host === null) return

	if (mPickedCiphers === null) {
		mPickedCiphers = (mCiphers && mCiphers.ciphers) ? mCiphers.ciphers.slice() : []
	}

	var available = (typeof matchAvailableCiphers === "function") ? matchAvailableCiphers() : []
	// anything already chosen stays offerable even if it is switched off in the
	// calculator now, so saving does not silently drop it
	for (var i = 0; i < mPickedCiphers.length; i++) {
		if (available.indexOf(mPickedCiphers[i]) === -1) available.push(mPickedCiphers[i])
	}

	var o = ''
	if (!available.length) {
		o += '<div class="matchHint">No cyphers are switched on. Open the calculator, turn some on in the ' +
			'<b>Cyphers</b> menu, and come back &mdash; this list follows whatever you have enabled there.</div>'
		host.innerHTML = o
		return
	}

	o += '<div class="matchField">'
	o += '<label class="matchLabel" for="mPhrase">Phrase to compare</label>'
	o += '<input class="matchInput" type="text" id="mPhrase" maxlength="120" placeholder="Your name works well" value="' +
		authEsc(mCiphers ? (mCiphers.key_phrase || "") : "") + '" oninput="matchPreviewValues()">'
	o += '</div>'

	o += '<div class="matchChips">'
	for (var a = 0; a < available.length; a++) {
		var on = mPickedCiphers.indexOf(available[a]) > -1
		o += '<button class="matchChip' + (on ? ' matchChipOn' : '') + '" type="button" ' +
			'onclick="matchToggleCipher(' + a + ')" data-name="' + authEsc(available[a]) + '">' +
			authEsc(available[a]) + '</button>'
	}
	o += '</div>'
	o += '<div class="matchHint">Up to twelve. Fewer and sharper beats all of them.</div>'

	o += '<div id="mValuePreview" class="matchSigRow"></div>'
	o += '<button class="matchBtn matchBtnPrimary" type="button" id="mSaveCiphers" onclick="matchSaveCiphers()">Save my cyphers</button>'
	o += '<div id="mCipherMsg" class="matchMsg"></div>'

	host.innerHTML = o
	matchAvailableCache = available
	matchPreviewValues()
}

var matchAvailableCache = []

function matchToggleCipher(i) {
	var name = matchAvailableCache[i]
	if (!name) return
	var at = mPickedCiphers.indexOf(name)
	if (at > -1) mPickedCiphers.splice(at, 1)
	else if (mPickedCiphers.length < 12) mPickedCiphers.push(name)
	else { matchToast("Twelve is the limit", true); return }
	matchPaintCiphers()
}

// Shows the numbers before they are saved, so nobody is agreeing to store a
// value they have not seen.
function matchPreviewValues() {
	var host = document.getElementById("mValuePreview")
	var box = document.getElementById("mPhrase")
	if (host === null || box === null) return
	var phrase = box.value.trim()
	if (phrase === "" || !mPickedCiphers.length) { host.innerHTML = ""; return }

	var values = matchCipherValues(phrase, mPickedCiphers)
	var o = ''
	for (var k in values) {
		if (!values.hasOwnProperty(k)) continue
		o += '<span class="matchSigChip"><b>' + authEsc(k) + '</b> ' + authEsc(values[k]) + '</span>'
	}
	host.innerHTML = o
}

function matchSaveCiphers() {
	var box = document.getElementById("mPhrase")
	var msg = document.getElementById("mCipherMsg")
	var btn = document.getElementById("mSaveCiphers")
	var phrase = box ? box.value.trim() : ""

	if (mPickedCiphers.length === 0) return matchMsg(msg, "Pick at least one cypher.", true)
	if (phrase === "") return matchMsg(msg, "Add a phrase to compare.", true)

	var values = matchCipherValues(phrase, mPickedCiphers)
	btn.disabled = true
	matchCiphersSave(mPickedCiphers, phrase, values).then(function (saved) {
		btn.disabled = false
		mCiphers = saved
		mMatches = null
		matchMsg(msg, "Saved.", false)
		return matchStatus()
	}).then(function (st) {
		mStatus = st
		matchRefreshSteps()
	}).catch(function (err) {
		btn.disabled = false
		matchMsg(msg, err.message || "Could not save", true)
	})
}

// ---- consent -----------------------------------------------------------

function matchPaintConsent() {
	var host = document.getElementById("matchConsent")
	if (host === null) return

	var on = !!(mProfile && mProfile.matching_opt_in)
	var ready = !!(mProfile && mProfile.birth_date)

	var o = ''
	o += '<div class="matchSwitchRow' + (on ? ' matchSwitchOn' : '') + (ready ? '' : ' matchSwitchOff') + '" ' +
		(ready ? 'onclick="matchToggleOptIn(this)"' : '') + '>'
	o += '<span class="matchSwitchBody"><span class="matchSwitchTitle">Include me in matching</span>'
	o += '<span class="matchSwitchBlurb">' + (ready
		? 'Other subscribers can find you and see what you have in common. Your birth details are never shown.'
		: 'Save your birth details first.') + '</span></span>'
	o += '<span class="matchSwitch"><span class="matchSwitchKnob"></span></span>'
	o += '</div>'

	o += '<div class="matchLegal">'
	o += '<b>What is stored:</b> your date of birth, and &mdash; only if you gave them &mdash; time and place. ' +
		'They are readable by you and by nobody else. Matching compares the chart they produce and reports ' +
		'only what two people share.<br>'
	o += '<b>What is never stored:</b> card details. Payments are handled entirely by the payment provider.<br>'
	o += '<b>Changing your mind:</b> turning the switch off removes you from everyone\'s results immediately. ' +
		'Erase deletes the data outright.'
	o += '</div>'

	if (ready) {
		o += '<button class="matchBtn matchBtnDanger matchBtnSm" type="button" id="mForget" onclick="matchEraseData(this)">' +
			'Erase my birth data</button>'
	}

	host.innerHTML = o
}

function matchToggleOptIn(row) {
	var on = !row.classList.contains("matchSwitchOn")
	row.classList.toggle("matchSwitchOn", on)
	matchOptIn(on).then(function (saved) {
		mProfile = saved
		mMatches = null
		matchToast(on ? "You are in" : "Removed from matching")
		return matchStatus()
	}).then(function (st) {
		mStatus = st
		matchRefreshSteps()
	}).catch(function (err) {
		row.classList.toggle("matchSwitchOn", !on)
		matchToast(err.message || "Could not change that", true)
	})
}

function matchEraseData(btn) {
	if (btn.dataset.armed !== "1") {
		btn.dataset.armed = "1"
		btn.textContent = "Erase — are you sure?"
		setTimeout(function () {
			if (btn.dataset.armed !== "1") return
			btn.dataset.armed = ""
			btn.textContent = "Erase my birth data"
		}, 4000)
		return
	}
	btn.disabled = true
	matchForget().then(function () {
		mProfile = null; mCiphers = null; mPickedCiphers = null; mMatches = null; mForm = null
		matchToast("Erased")
		return matchStatus()
	}).then(function (st) {
		mStatus = st
		mSetupOpen = false
		matchRender()
	}).catch(function (err) {
		btn.disabled = false
		matchToast(err.message || "Could not erase", true)
	})
}

// Redraws only the step row, so saving one panel does not wipe another.
function matchRefreshSteps() {
	var row = document.querySelector(".matchSteps")
	if (row === null) return
	row.outerHTML = '<div class="matchSteps">' +
		matchStepDot(1, "Birth details", !!(mStatus && mStatus.has_birth_data)) +
		matchStepDot(2, "Your cyphers", !!(mStatus && mStatus.cipher_count > 0)) +
		matchStepDot(3, "Switch it on", !!(mStatus && mStatus.opted_in)) + '</div>'

	// everything is answered - offer the list rather than making them hunt
	if (mStatus && mStatus.has_birth_data && mStatus.opted_in) {
		var bar = document.querySelector(".matchDoneBar")
		if (bar === null) {
			$('<div class="matchDoneBar"><button class="matchBtn matchBtnPrimary" onclick="matchCloseSetup()">' +
				'See my matches &#8594;</button></div>').insertAfter(".matchSteps")
		}
	}
}

function matchCloseSetup() { mSetupOpen = false; matchRender() }
function matchOpenSetup()  { mSetupOpen = true;  matchRender() }

// ---- state: matches ----------------------------------------------------

function matchListHtml() {
	var o = '<div class="matchBar">'
	o += '<button class="matchBtn matchBtnGhost matchBtnSm" onclick="matchOpenSetup()">&#9881; My matching profile</button>'
	o += '<button class="matchBtn matchBtnGhost matchBtnSm" onclick="matchReload()">&#8635; Refresh</button>'
	o += '</div>'
	o += '<div id="matchResults">' + (mMatches === null
		? '<div class="matchLoading">Reading the charts…</div>'
		: matchCardsHtml()) + '</div>'
	return o
}

function matchLoadList() {
	matchList(40, 0).then(function (rows) {
		mMatches = rows
		var host = document.getElementById("matchResults")
		if (host !== null) host.innerHTML = matchCardsHtml()
	}).catch(function (err) {
		var host = document.getElementById("matchResults")
		if (host !== null) {
			host.innerHTML = '<div class="matchCard matchCardWarn">' + authEsc(err.message || String(err)) + '</div>'
		}
	})
}

function matchReload() { mMatches = null; matchRender() }

function matchCardsHtml() {
	if (!mMatches.length) {
		var pool = mStatus ? mStatus.pool : 0
		return '<div class="matchCard matchEmpty">' +
			(pool === 0
				? '<b>Nobody else is in the pool yet.</b><br>You are early. As members switch matching on, they will appear here.'
				: '<b>No overlap yet.</b><br>There ' + (pool === 1 ? 'is 1 other member' : 'are ' + pool + ' other members') +
				  ' in the pool, and none of them share enough with you to rank. Adding a birth time, or more cypher ' +
				  'systems, gives the comparison more to work with.') +
			'</div>'
	}

	var o = '<div class="matchCount">' + mMatches.length +
		(mMatches.length === 1 ? ' member' : ' members') + ', closest first</div>'
	o += '<div class="matchList">'
	for (var i = 0; i < mMatches.length; i++) o += matchCardHtml(mMatches[i], i)
	o += '</div>'
	return o
}

function matchCardHtml(m, i) {
	var o = '<div class="matchItem' + (i === 0 ? ' matchItemTop' : '') + '">'

	o += '<div class="matchWho">'
	o += matchAvatarHtml(m)
	o += '<div class="matchWhoText">'
	o += '<div class="matchName">' + authEsc(m.display_name)
	if (m.is_friend) o += '<span class="matchTag">friend</span>'
	o += '</div>'
	o += '<div class="matchWhen">' + matchSeen(m.last_active_at) + '</div>'
	o += '</div>'
	o += matchScoreHtml(m.score)
	o += '</div>'

	var factors = m.factors || []
	if (factors.length) {
		o += '<div class="matchFactors">'
		for (var f = 0; f < factors.length; f++) {
			o += '<span class="matchFactor">' + authEsc(factors[f]) + '</span>'
		}
		o += '</div>'
	}

	o += '<div class="matchActions">'
	o += '<button class="matchBtn matchBtnSm" onclick="matchViewProfile(&quot;' + m.member_id + '&quot;)">View profile</button>'
	o += '<button class="matchBtn matchBtnSm matchBtnGhost" onclick="matchConnect(this,&quot;' + m.member_id + '&quot;)">Connect</button>'
	o += '<button class="matchBtn matchBtnSm matchBtnGhost matchBtnEso" ' +
		'onclick="matchExplain(this,&quot;' + m.member_id + '&quot;)">&#128302; Explain this match</button>'
	o += '</div>'

	// the reading lands here, under the card that asked for it
	o += '<div class="matchReading" id="eso-' + m.member_id + '"></div>'

	o += '</div>'
	return o
}

// Asks for a reading about what two people share. Nothing about the request
// describes the chart - the member id is all that crosses, and the server
// fetches the rest under this member's own token, which is what keeps the
// subscription gate and the other person's opt-in in force.
function matchExplain(btn, id) {
	var host = document.getElementById("eso-" + id)
	if (host === null) return

	if (host.dataset.open === "1") {   // second click closes it
		host.dataset.open = ""
		host.innerHTML = ""
		btn.innerHTML = "&#128302; Explain this match"
		return
	}

	btn.disabled = true
	host.dataset.open = "1"
	host.innerHTML = '<div class="matchReadingBody"><span class="esoWait">Reading the numbers…</span></div>'

	esotericAsk("compatibility_summary", { subject: id }).then(function (out) {
		btn.disabled = false
		btn.innerHTML = "&#10005; Hide reading"
		var o = '<div class="matchReadingBody">' + esotericRender(out.text) + '</div>'
		o += '<div class="matchReadingFoot">'
		o += '<span>Written by Claude from the symbols you share. Reflective, not predictive &mdash; ' +
			'and never about health, money, or whether to meet.</span>'
		if (out.per_day) o += '<span class="esoQuota">' + out.used_today + ' of ' + out.per_day + ' today</span>'
		o += '</div>'
		host.innerHTML = o
	}).catch(function (err) {
		btn.disabled = false
		host.dataset.open = ""
		host.innerHTML = '<div class="matchReadingBody matchReadingErr">' + authEsc(err.message) +
			(err.overLimit ? ' Readings reset on a rolling 24-hour window.' : '') + '</div>'
	})
}

// A ring rather than a bar: a percentage is a proportion of a whole, and a
// ring says that without needing a scale printed next to it.
function matchScoreHtml(score) {
	var pct = Math.max(0, Math.min(100, Number(score) || 0))
	var band = pct >= 70 ? " matchScoreHigh" : (pct >= 40 ? " matchScoreMid" : "")
	return '<div class="matchScore' + band + '" style="--pct:' + pct + '" ' +
		'title="How much of your chart and cypher work you have in common">' +
		'<span class="matchScoreN">' + pct + '<span class="matchScorePc">%</span></span></div>'
}

function matchAvatarHtml(m) {
	if (m.avatar) {
		return '<img class="matchAvatar" src="' + authEsc(m.avatar) + '" alt="">'
	}
	var letter = (m.display_name || "?").charAt(0).toUpperCase()
	return '<div class="matchAvatar matchAvatarLetter">' + authEsc(letter) + '</div>'
}

function matchSeen(iso) {
	if (!iso) return "&nbsp;"
	var t = Date.parse(iso)
	if (!isFinite(t)) return "&nbsp;"
	var s = Math.floor((Date.now() - t) / 1000)
	if (s < 300) return "online now"
	if (s < 3600) return "active " + Math.floor(s / 60) + "m ago"
	if (s < 86400) return "active " + Math.floor(s / 3600) + "h ago"
	return "active " + Math.floor(s / 86400) + "d ago"
}

// The public profile already exists in the Membership panel, so this hands
// over to it rather than building a second one that would drift.
function matchViewProfile(id) {
	window.location.href = "index.html#member=" + encodeURIComponent(id)
}

// Deliberately a placeholder. The shape it will take is a friend request,
// because that is the consent step the rest of the site already uses - and
// once accepted, chat is already built. A Discord DM is the other candidate
// and it needs the bot, which does not exist yet.
function matchConnect(btn, id) {
	btn.disabled = true
	btn.textContent = "Coming soon"
	matchToast("Connecting is not open yet — send them a friend request from their profile")
}

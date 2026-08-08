// ======================= Matching client =======================
//
// Two halves. The first turns a birth date into a signature - a dozen small
// integers - using the same ephemeris the Astrology tab draws from. The second
// talks to the database.
//
// The signature is computed here rather than in Postgres because the orbital
// elements are 400 lines of trigonometry that already exist in calc/astrology.js
// and porting them to PL/pgSQL to defend against somebody misreporting their
// own birthday would be a strange use of a week. The gate that matters - who
// may READ matches - is in the database, where it cannot be edited from a
// browser.
//
// What crosses the wire between two members is never a birth date. The server
// compares signatures and returns sentences about what is shared.

function matchRpc(name, args) {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || typeof authUser === "undefined" || authUser === null) {
		return Promise.reject(new Error("Not signed in"))
	}
	return c.rpc(name, args || {}).then(function (res) {
		if (res.error) throw matchError(res.error)
		return res.data
	}, function (err) { throw matchError(err) })
}

// The database raises with wording meant to be read, so those come through
// untouched. Only the two structural failures get rewritten.
function matchError(err) {
	var m = (err && err.message) ? err.message : String(err)
	if (m.indexOf("does not exist") > -1 || m.indexOf("schema cache") > -1) {
		return new Error("Matching needs its database migration to be run. See AUTH-SETUP.md.")
	}
	if (m.indexOf("Failed to fetch") > -1 || m.indexOf("NetworkError") > -1) {
		return new Error("Could not reach the server.")
	}
	return new Error(m)
}

// ---- reading -----------------------------------------------------------

function matchStatus() {
	return matchRpc("match_status").then(function (r) {
		return (r && r.length) ? r[0] : null
	})
}

function matchList(limit, offset) {
	return matchRpc("match_list", { lim: limit || 40, off: offset || 0 })
		.then(function (r) { return r || [] })
}

// ---- the member's own matching profile ---------------------------------

function matchProfileGet() {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	return c.from("user_birth_data").select("*").eq("user_id", authUser.id).maybeSingle()
		.then(function (res) {
			if (res.error) throw matchError(res.error)
			return res.data
		})
}

function matchProfileSave(row) {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	row.user_id = authUser.id
	// life_path is set by a trigger; sending one would just be ignored
	delete row.life_path
	return c.from("user_birth_data").upsert(row, { onConflict: "user_id" }).select().single()
		.then(function (res) {
			if (res.error) throw matchError(res.error)
			return res.data
		})
}

function matchCiphersGet() {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	return c.from("user_cypher_preferences").select("*").eq("user_id", authUser.id).maybeSingle()
		.then(function (res) {
			if (res.error) throw matchError(res.error)
			return res.data
		})
}

function matchCiphersSave(names, phrase, values) {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	return c.from("user_cypher_preferences").upsert({
		user_id: authUser.id,
		ciphers: names || [],
		key_phrase: phrase || "",
		cipher_values: values || {}
	}, { onConflict: "user_id" }).select().single().then(function (res) {
		if (res.error) throw matchError(res.error)
		return res.data
	})
}

// A plain UPDATE, not an upsert of a two-key object. An upsert writes the
// whole row, so toggling consent that way would blank every sign in the
// signature and leave a matching profile that matches nothing.
function matchOptIn(on) {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	return c.from("user_birth_data").update({ matching_opt_in: !!on })
		.eq("user_id", authUser.id).select().single()
		.then(function (res) {
			if (res.error) throw matchError(res.error)
			return res.data
		})
}

// Right to erasure for this feature alone, for the member who wants to stay on
// the site but wants their birth data gone.
function matchForget() { return matchRpc("match_forget") }

// ---- deriving the signature --------------------------------------------

var MATCH_SIGNATURE_BODIES = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"]

// form: { y, m, d, hh, mm, timeKnown, lat, lon, tz, zodiac }
//
// An unknown birth time is treated as noon, which holds every body except the
// Moon to a fraction of a degree. The Ascendant is left null rather than
// guessed - it moves a whole sign every two hours, so a guess would be a
// coin toss dressed up as a fact, and matching on it would be worse than not
// matching on it at all.
function matchDeriveSignature(form) {
	if (typeof astroChart !== "function") return null

	var timeKnown = !!form.timeKnown
	var hh = timeKnown ? Number(form.hh) : 12
	var mm = timeKnown ? Number(form.mm) : 0
	var ut = hh + mm / 60 - Number(form.tz || 0)
	var loc = (timeKnown && isFinite(form.lat) && isFinite(form.lon))
		? { lat: Number(form.lat), lon: Number(form.lon), system: "whole" }
		: null

	var chart = astroChart(Number(form.y), Number(form.m), Number(form.d), ut, loc)
	if (form.zodiac === "sidereal" && typeof astroToSidereal === "function") {
		chart = astroToSidereal(chart)
	}

	var out = { zodiac: form.zodiac === "sidereal" ? "sidereal" : "tropical" }
	for (var i = 0; i < chart.bodies.length; i++) {
		var b = chart.bodies[i]
		if (MATCH_SIGNATURE_BODIES.indexOf(b.key) === -1) continue
		out[b.key + "_sign"] = b.signIdx
	}
	out.asc_sign = (chart.ascSign && timeKnown) ? chart.ascSign.idx : null
	return out
}

// The values the member's chosen phrase comes to, in the systems they picked.
// Reads the live cipherList, so it follows whatever the calculator currently
// has loaded - including ciphers the member wrote themselves.
//
// Wheel cyphers return NaN from calcGematria and are skipped: a preference
// stored as "NaN" would match every other NaN on the site, which is the exact
// opposite of a meaningful match.
function matchCipherValues(phrase, names) {
	var out = {}
	if (typeof cipherList === "undefined" || !phrase) return out
	for (var i = 0; i < cipherList.length; i++) {
		var c = cipherList[i]
		if (names.indexOf(c.cipherName) === -1) continue
		var v = c.calcGematria(phrase)
		if (typeof v !== "number" || !isFinite(v)) continue
		out[c.cipherName] = String(v)
	}
	return out
}

// Which cyphers the member could choose from: the ones switched on in the
// calculator, capped at the twelve the column allows.
function matchAvailableCiphers() {
	var out = []
	if (typeof cipherList === "undefined") return out
	for (var i = 0; i < cipherList.length && out.length < 12; i++) {
		if (cipherList[i].enabled) out.push(cipherList[i].cipherName)
	}
	return out
}

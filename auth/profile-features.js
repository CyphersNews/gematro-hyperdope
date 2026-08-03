// ================ Account features: entries, submissions, ================
// ================ leaderboard and avatar upload          ================
//
// Everything here needs a signed-in user. Nothing runs for anonymous visitors.
//
// Publishing is deliberate and per phrase: saving to your history is private,
// submitting one is a separate act. Nothing you decode becomes visible to
// anyone else unless you submit it.

// ---- searching your own saved entries ---------------------------------

// Searches history_entries, which RLS already restricts to the caller, so no
// user id needs to be trusted from the client. The term is passed as a bound
// parameter by PostgREST, not interpolated into SQL.
function entriesSearch(term, limit) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.resolve([])

	var q = client.from("history_entries").select("id, phrase, created_at")
	term = String(term || "").trim()
	if (term !== "") {
		// escape the LIKE wildcards so a literal % or _ searches for itself
		var safe = term.replace(/[%_\\]/g, function (c) { return "\\" + c })
		q = q.ilike("phrase", "%" + safe + "%")
	}
	return q.order("created_at", { ascending: false }).limit(limit || 100)
		.then(function (res) {
			if (res.error) throw res.error
			return res.data || []
		})
}

function entriesDelete(id) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	return client.from("history_entries").delete().eq("id", id)
		.then(function (res) { if (res.error) throw res.error; return true })
}

// ---- submissions ------------------------------------------------------

function submissionsList(limit) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.resolve([])
	return client.from("phrase_submissions")
		.select("id, phrase, created_at")
		.eq("user_id", authUser.id)
		.order("created_at", { ascending: false })
		.limit(limit || 200)
		.then(function (res) {
			if (res.error) throw res.error
			return res.data || []
		})
}

// Is this phrase in the database the user currently has loaded? Comparison is
// case-insensitive and trimmed, so "Cyphers News" and "cyphers news" are the
// same phrase. Returns false when no database is loaded, which is the common
// case and correctly imposes no restriction.
//
// Live mode holds plain phrase strings; precalculated mode holds a row per
// phrase with the phrase at index 0.
// The shipped database is around 97,000 phrases, so the lookup is indexed
// rather than scanned. The index is rebuilt whenever the row counts change,
// which is the only way the loaded database can change - import, unload or a
// switch between live and precalculated mode.
var dbPhraseIndex = null
var dbPhraseIndexKey = ""

function dbPhraseIndexFor() {
	var liveLen = (typeof userDBlive !== "undefined") ? userDBlive.length : 0
	var dbLen = (typeof userDB !== "undefined") ? userDB.length : 0
	var key = liveLen + "/" + dbLen
	if (dbPhraseIndex !== null && dbPhraseIndexKey === key) return dbPhraseIndex

	var set = Object.create(null)
	var i
	for (i = 0; i < liveLen; i++) set[String(userDBlive[i]).trim().toLowerCase()] = true
	for (i = 0; i < dbLen; i++) {
		var row = userDB[i]
		set[String(Array.isArray(row) ? row[0] : row).trim().toLowerCase()] = true
	}
	dbPhraseIndex = set
	dbPhraseIndexKey = key
	return set
}

function phraseInLoadedDatabase(phrase) {
	var needle = String(phrase || "").trim().toLowerCase()
	if (needle === "") return false
	return dbPhraseIndexFor()[needle] === true
}

// Has anyone already published this phrase? Case-insensitive, so a different
// capitalisation does not count as a new phrase.
//
// This is a courtesy check so the UI can explain the problem before the write
// is attempted. The rule itself is the unique index on lower(btrim(phrase)) -
// see the submissions_unique_global migration.
function phraseAlreadyPublished(phrase) {
	var client = getAuthClient()
	if (client === null) return Promise.resolve(null)
	var needle = String(phrase || "").trim()
	if (needle === "") return Promise.resolve(null)

	return client.from("phrase_submissions")
		.select("id,user_id,phrase")
		.ilike("phrase", needle)   // ILIKE with no wildcards is a case-insensitive equality test
		.limit(1)
		.then(function (res) {
			if (res.error) return null
			if (!res.data || res.data.length === 0) return null
			return res.data[0]
		})
		.catch(function () { return null })
}

function submissionSubmit(phrase) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	phrase = String(phrase || "").trim()
	if (phrase === "") return Promise.reject(new Error("Nothing to submit"))
	if (phrase.length > 500) return Promise.reject(new Error("That phrase is too long to submit"))

	// already in the loaded corpus, so publishing it adds nothing
	if (phraseInLoadedDatabase(phrase)) {
		return Promise.reject(new Error("That phrase is already in the database"))
	}

	return phraseAlreadyPublished(phrase).then(function (existing) {
		if (existing !== null) {
			throw new Error(existing.user_id === authUser.id
				? "You have already submitted that phrase"
				: "Someone else has already published that phrase")
		}
		return client.from("phrase_submissions")
			.insert({ user_id: authUser.id, phrase: phrase })
			.then(function (res) {
				if (res.error) {
					// the unique index is the real guard - this catches the race
					// where someone else published the same phrase in between
					if ((res.error.message || "").toLowerCase().indexOf("duplicate") > -1) {
						throw new Error("Someone else has already published that phrase")
					}
					throw res.error
				}
				return true
			})
	})
}

function submissionWithdraw(id) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	return client.from("phrase_submissions").delete().eq("id", id)
		.then(function (res) { if (res.error) throw res.error; return true })
}

// which of these phrases has the user already submitted, so the UI can show
// the right state without a request per row
function submissionsFor(phrases) {
	var client = getAuthClient()
	if (client === null || authUser === null || !phrases.length) return Promise.resolve({})
	return client.from("phrase_submissions")
		.select("id, phrase")
		.eq("user_id", authUser.id)
		.in("phrase", phrases)
		.then(function (res) {
			if (res.error) return {}
			var map = {}
			;(res.data || []).forEach(function (r) { map[r.phrase] = r.id })
			return map
		})
}

// ---- leaderboard ------------------------------------------------------

// Reads the leaderboard view, which exposes display name, avatar and counts
// and never touches email.
function leaderboardTop(limit) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.resolve([])
	return client.from("leaderboard").select("*").limit(limit || 25)
		.then(function (res) {
			if (res.error) throw res.error
			return res.data || []
		})
}

// A contributor's published phrases. Only ever returns submitted rows, so a
// private history entry can never appear here.
function leaderboardPhrases(userId, limit) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.resolve([])
	return client.from("phrase_submissions")
		.select("phrase, created_at")
		.eq("user_id", userId)
		.order("created_at", { ascending: false })
		.limit(limit || 50)
		.then(function (res) {
			if (res.error) throw res.error
			return res.data || []
		})
}

// ---- avatar upload ----------------------------------------------------

var AVATAR_MAX_BYTES = 2 * 1024 * 1024
var AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]

// Checked here for a fast, friendly error; the bucket enforces both limits
// again server-side, so a crafted request cannot bypass them.
function avatarValidate(file) {
	if (!file) return "Choose an image first."
	if (AVATAR_TYPES.indexOf(file.type) === -1) return "Use a PNG, JPEG, WebP or GIF."
	if (file.size > AVATAR_MAX_BYTES) return "That image is over 2 MB."
	return null
}

function avatarUpload(file) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.reject(new Error("Not signed in"))

	var problem = avatarValidate(file)
	if (problem) return Promise.reject(new Error(problem))

	// stored under a folder named after the uid, which is what the storage
	// policy pins writes to; the timestamp busts any cached copy
	var ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg")
	var path = authUser.id + "/avatar-" + Date.now() + "." + ext

	return client.storage.from("avatars")
		.upload(path, file, { cacheControl: "3600", upsert: true, contentType: file.type })
		.then(function (res) {
			if (res.error) throw res.error
			var pub = client.storage.from("avatars").getPublicUrl(path)
			var url = pub.data.publicUrl
			return updateProfile({ avatar_url: url }).then(function () {
				avatarCleanupOld(path)
				return url
			})
		})
}

function avatarRemove() {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	return updateProfile({ avatar_url: null }).then(function () {
		avatarCleanupOld(null) // nothing to keep, drop them all
		return true
	})
}

// Deletes the user's older avatar files so the bucket does not accumulate one
// image per upload. Failure here is not worth surfacing.
function avatarCleanupOld(keepPath) {
	var client = getAuthClient()
	if (client === null || authUser === null) return
	client.storage.from("avatars").list(authUser.id, { limit: 100 })
		.then(function (res) {
			if (res.error || !res.data) return
			var doomed = res.data
				.map(function (f) { return authUser.id + "/" + f.name })
				.filter(function (p) { return p !== keepPath })
			if (doomed.length) client.storage.from("avatars").remove(doomed)
		})
		.catch(function () { /* housekeeping only */ })
}

// ---- presets ----------------------------------------------------------
//
// A preset is a named settings blob: enabled ciphers, custom ciphers, colours
// and code rain settings, in the same format the workspace and "Export
// Settings (JS)" already use. Loading one goes through the calculator's own
// import path, so there is a single format to keep working rather than two.

function presetsList() {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.resolve([])
	return client.from("presets")
		.select("id,name,updated_at")
		.eq("user_id", authUser.id)
		.order("name", { ascending: true })
		.then(function (res) {
			if (res.error) throw res.error
			return res.data || []
		})
}

// Saves the calculator's current state under a name. Saving over a name that
// already exists overwrites it, which is what "Save" on an existing preset
// means to a user - hence upsert on (user_id, name) rather than an insert
// that would trip the unique index.
function presetSave(name) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	name = String(name || "").trim()
	if (name === "") return Promise.reject(new Error("Give the preset a name"))
	if (name.length > 60) return Promise.reject(new Error("That name is too long"))

	var settings = wsCurrentSettings()
	if (settings === null) return Promise.reject(new Error("Could not read the current settings"))

	// find an existing preset with this name first: the unique index is on
	// lower(btrim(name)), which upsert's onConflict cannot target directly
	return presetsList().then(function (rows) {
		var hit = null
		for (var i = 0; i < rows.length; i++) {
			if (rows[i].name.trim().toLowerCase() === name.toLowerCase()) { hit = rows[i]; break }
		}
		if (hit !== null) {
			return client.from("presets")
				.update({ name: name, settings: settings })
				.eq("id", hit.id)
				.then(function (res) { if (res.error) throw res.error; return "updated" })
		}
		return client.from("presets")
			.insert({ user_id: authUser.id, name: name, settings: settings })
			.then(function (res) { if (res.error) throw res.error; return "created" })
	})
}

function presetLoad(id) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	return client.from("presets").select("name,settings").eq("id", id).maybeSingle()
		.then(function (res) {
			if (res.error) throw res.error
			if (!res.data || !res.data.settings) throw new Error("That preset is empty")
			if (typeof applyCalcSettingsString !== "function") throw new Error("Calculator not ready")
			var ok = applyCalcSettingsString(res.data.settings, true)
			if (!ok) throw new Error("That preset could not be read")
			// the workspace now differs from what was last synced
			if (typeof wsSyncLastHash !== "undefined") wsSyncLastHash = null
			return res.data.name
		})
}

function presetDelete(id) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	return client.from("presets").delete().eq("id", id)
		.then(function (res) { if (res.error) throw res.error; return true })
}

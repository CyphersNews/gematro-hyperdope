// ======================= Feature flags =======================
//
// The site is served as static files, so there is no build step and no place
// to inject an environment variable. Flags therefore live in two layers:
//
//   FLAG_DEFAULTS below - what to assume before the network answers, and what
//   to fall back to if it never does. Editing this file is a deploy.
//
//   the feature_flags table  - the real answer, editable from the admin panel
//   without touching the repository. This is the one that matters.
//
// Neither layer is a security boundary and neither is trusted for anything but
// drawing. A flag here decides whether a button is shown; match_list() in the
// database decides whether the data comes back, and it reads the same table
// server-side. Turning matching_requires_payment off in this file would change
// what the page renders and change nothing at all about what it can fetch.

var FLAG_DEFAULTS = {
	matching_enabled: true,           // master switch for the whole Matching feature
	matching_requires_payment: true,  // false opens Matching to every signed-in member

	// TESTING MODE. True gives every signed-in member Matching and the paid
	// reading allowance with no subscription. Stripe still works and can still
	// be tested; it is simply not required.
	//
	// This is the deploy-time default only — it decides what the page draws in
	// the moment before feature_flags answers. The authority is the row, because
	// the gate is match_list() inside Postgres and Postgres cannot read this
	// file. Flip the row (admin panel -> Flags, or one UPDATE) and paid gating
	// returns on the next call with no deploy.
	//
	// >>> SET THIS TO false BEFORE LAUNCH, and turn the row off too. <<<
	matching_force_free: true,

	matching_llm_depth: false         // reserved for the esoteric write-ups
}

var flagValues = null
var flagLoading = null

function flagsClient() {
	return (typeof getAuthClient === "function") ? getAuthClient() : null
}

// One fetch per page load. Flags change rarely and a stale one for a few
// minutes costs nothing, so there is no refresh timer - a reload is enough.
function flagsLoad(force) {
	if (!force && flagValues !== null) return Promise.resolve(flagValues)
	if (!force && flagLoading !== null) return flagLoading

	var c = flagsClient()
	if (c === null) {
		flagValues = flagsCopyDefaults()
		return Promise.resolve(flagValues)
	}

	// A missing table, a network failure and a row that is simply absent all
	// land in the same place: the default. Nothing here throws, because there
	// is no failure mode where the right answer is "no flags at all".
	flagLoading = c.from("feature_flags").select("key, enabled").then(function (res) {
		var out = flagsCopyDefaults()
		if (!res.error && res.data) {
			for (var i = 0; i < res.data.length; i++) out[res.data[i].key] = !!res.data[i].enabled
		}
		return out
	}).catch(function () {
		return flagsCopyDefaults()
	}).then(function (out) {
		flagValues = out
		flagLoading = null
		return out
	})
	return flagLoading
}

function flagsCopyDefaults() {
	var out = {}
	for (var k in FLAG_DEFAULTS) if (FLAG_DEFAULTS.hasOwnProperty(k)) out[k] = FLAG_DEFAULTS[k]
	return out
}

// Synchronous, for code that runs after flagsLoad() has resolved. Before that
// it answers from the defaults, which is the right answer to give when the
// truth has not arrived yet.
function flagEnabled(key) {
	if (flagValues !== null && flagValues[key] !== undefined) return !!flagValues[key]
	return !!FLAG_DEFAULTS[key]
}

function flagsInvalidate() { flagValues = null; flagLoading = null }

// ======================= Social feed client =======================
//
// A post is built from a row of your own History Table, not typed. The phrase
// and the readings come from what the calculator already worked out, and the
// only free text is the caption - which the database puts through the same
// filter chat uses before it will store it.
//
// There is no insert policy on posts. post_create() is the only writer, for
// the same reason messages have none: a filter you can go around is a
// suggestion.

function socialRpc(name, args) {
	var c = (typeof getAuthClient === "function") ? getAuthClient() : null
	if (c === null || typeof authUser === "undefined" || authUser === null) {
		return Promise.reject(new Error("Not signed in"))
	}
	return c.rpc(name, args || {}).then(function (res) {
		if (res.error) throw friendsError(res.error) // same "run the migration" handling
		return res.data
	}, function (err) { throw friendsError(err) })
}

// scope: all | friends | mine | top
function socialFeed(scope, limit, offset) {
	return socialRpc("feed_list", { scope: scope || "all", lim: limit || 30, off: offset || 0 })
		.then(function (r) { return r || [] })
}

function socialPost(phrase, readings, caption) {
	return socialRpc("post_create", { phrase: phrase, readings: readings, caption: caption || null })
}

function socialLike(postId, on) {
	return socialRpc("post_like", { post: postId, on_off: !!on })
}

function socialDelete(postId) {
	var c = getAuthClient()
	return c.from("posts").delete().eq("id", postId).then(function (res) {
		if (res.error) throw friendsError(res.error)
		return true
	})
}

// ---- what is shareable right now ---------------------------------------
//
// Read straight out of the live calculator rather than from the server: the
// History Table is the thing in front of the user, and a phrase they can see
// is a phrase they can share. Only enabled cyphers, because those are the ones
// with a value on screen.
//
// Wheel cyphers are skipped - gemForMatching returns NaN for them, and a
// reading of "NaN" is not a finding.

function socialReadingsFor(phrase) {
	var out = []
	if (typeof cipherList === "undefined") return out
	for (var i = 0; i < cipherList.length; i++) {
		if (!cipherList[i].enabled) continue
		var v = cipherList[i].calcGematria(phrase)
		if (typeof v !== "number" || !isFinite(v)) continue
		out.push({ cipher: cipherList[i].cipherName, value: v })
		if (out.length >= 8) break // the column cap the table enforces
	}
	return out
}

function socialSharablePhrases() {
	if (typeof sHistory === "undefined") return []
	return sHistory.slice(0, 100)
}

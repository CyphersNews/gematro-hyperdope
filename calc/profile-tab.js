// ========================= Profile tab ============================
//
// Top-level panel for account features: your saved entries, phrases you have
// published, and the contributor leaderboard.
//
// Signed-out visitors get a sign-in prompt rather than a broken panel; the
// calculator itself never requires an account.

var profileMenuOpened = false
var profileTabActive = "entries"
var profileSubmitMap = {}   // phrase -> submission id, for rows already published

function toggleProfileMenu() {
	if (!profileMenuOpened) {
		closeAllOpenedMenus()
		profileMenuOpened = true
		renderProfilePanel()
	} else {
		document.getElementById("profileMenuArea").innerHTML = ""
		profileMenuOpened = false
	}
}

function profileSetTab(tab) {
	profileTabActive = tab
	renderProfilePanel()
}

function renderProfilePanel() {
	var area = document.getElementById("profileMenuArea")
	if (area === null) return

	var o = '<div class="colorControlsBG profileBG">'
	o += '<input class="closeMenuBtn" type="button" value="&#215;" onclick="closeAllOpenedMenus()">'

	if (typeof authUser === "undefined" || authUser === null) {
		o += '<div class="profileSignedOut">'
		o += '<div class="profileSignedOutTitle">Sign in to use your profile &mdash; it\'s <span class="authFree">FREE</span></div>'
		o += '<div class="profileSignedOutText">Saved entries, submissions and the leaderboard need an account. '
		o += 'No cost, no card, <b>cancel anytime</b> &mdash; and the calculator itself stays free to use without one.</div>'
		o += '<div class="profileSignedOutBtns">'
		o += '<a class="intBtn3 profileCta" href="login.html">Sign in</a>'
		o += '<a class="intBtn3 profileCta profileCtaPrimary" href="register.html">Create an account</a>'
		o += '</div></div></div>'
		area.innerHTML = o
		return
	}

	o += '<div class="profileTabs">'
	o += profileTabBtn("entries", "Saved Entries")
	o += profileTabBtn("presets", "Presets")
	o += profileTabBtn("submissions", "My Submissions")
	o += profileTabBtn("leaderboard", "Leaderboard")
	o += profileTabBtn("account", "Account")
	o += '</div>'

	o += '<div id="profileBody" class="profileBody"><div class="profileLoading">Loading…</div></div>'
	o += '</div>'
	area.innerHTML = o

	// anything still in flight from the previous tab is now stale
	profileRenderSeq++

	if (profileTabActive === "entries") renderProfileEntries()
	else if (profileTabActive === "presets") renderProfilePresets()
	else if (profileTabActive === "submissions") renderProfileSubmissions()
	else if (profileTabActive === "leaderboard") renderProfileLeaderboard()
	else renderProfileAccount()
}

function profileTabBtn(id, label) {
	var on = (profileTabActive === id) ? " profileTabOn" : ""
	return '<input class="intBtn3 profileTab'+on+'" type="button" value="'+label+'" onclick="profileSetTab(&quot;'+id+'&quot;)">'
}

// Every tab loads over the network, so a slow tab's response can land after
// the user has already moved to another one and paint the wrong content into
// it. Each render is stamped with the tab that started it, and a write is
// dropped if that is no longer the tab on screen.
var profileRenderSeq = 0

function profileBody(html, token) {
	if (token !== undefined && token !== profileRenderSeq) return // stale response
	var el = document.getElementById("profileBody")
	if (el !== null) el.innerHTML = html
}

function profileErr(err) {
	var m = (err && err.message) ? err.message : String(err)
	if (m.indexOf("does not exist") > -1 || m.indexOf("schema cache") > -1) {
		return '<div class="profileNote profileWarn">This feature needs its database migration to be run. See AUTH-SETUP.md.</div>'
	}
	return '<div class="profileNote profileWarn">'+authEsc(m)+'</div>'
}

// ---- saved entries ----------------------------------------------------

function renderProfileEntries() {
	var tok = profileRenderSeq
	var term = ""
	var box = document.getElementById("profileSearch")
	if (box !== null) term = box.value

	entriesSearch(term, 200).then(function (rows) {
		var o = ''
		o += '<div class="profileSearchRow">'
		o += '<input type="text" id="profileSearch" class="profileSearchInput" placeholder="Search your saved phrases…" value="'+authEsc(term)+'" oninput="profileSearchDebounced()">'
		o += '<span class="profileCount">'+rows.length+(rows.length === 200 ? "+" : "")+'</span>'
		o += '</div>'

		if (rows.length === 0) {
			o += '<div class="profileNote">'+(term ? "Nothing matches that." : "No saved phrases yet. Anything you enter in the calculator is saved here automatically.")+'</div>'
			profileBody(o, tok)
			return
		}

		var phrases = rows.map(function (r) { return r.phrase })
		submissionsFor(phrases).then(function (map) {
			profileSubmitMap = map
			o += '<div class="profileList">'
			rows.forEach(function (r) {
				var published = map[r.phrase] !== undefined
				var refused = profileSubmitRejected[r.phrase]
				o += '<div class="profileRow'+(refused ? ' profileRowRefused' : '')+'">'
				o += '<span class="profileRowPhrase" onclick="profileUsePhrase(&quot;'+authEsc(r.phrase).replace(/"/g,'&quot;')+'&quot;)" title="Send to the calculator">'+authEsc(r.phrase)+'</span>'
				o += '<span class="profileRowActions">'
				if (published) {
					o += '<span class="profileBadge profileBadgeOk">published</span>'
				} else if (refused) {
					o += '<span class="profileBadge profileBadgeBad" title="'+authEsc(refused)+'">blocked</span>'
				} else {
					o += '<button class="profileMiniBtn" onclick="profileSubmit(&quot;'+authEsc(r.phrase).replace(/"/g,'&quot;')+'&quot;)" title="Publish this phrase to the leaderboard">Submit</button>'
				}
				o += '<button class="profileMiniBtn profileMiniDanger" onclick="profileDeleteEntry(&quot;'+r.id+'&quot;)" title="Remove from your saved history">&#215;</button>'
				o += '</span>'
				if (refused) o += '<div class="profileRowWhy">'+authEsc(refused)+'</div>'
				o += '</div>'
			})
			o += '</div>'
			o += '<div class="profileNote profileFoot">Saving is private. A phrase is only visible to others once you press Submit.'
			o += ' Phrases already in the database, or already published by someone else, cannot be submitted.</div>'
			profileBody(o, tok)
		})
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

var profileSearchTimer = null
function profileSearchDebounced() {
	clearTimeout(profileSearchTimer)
	profileSearchTimer = setTimeout(renderProfileEntries, 250)
}

function profileUsePhrase(p) {
	var box = document.getElementById("phraseBox")
	if (box === null) return
	box.value = p
	updateEnabledCipherTable()
	updateWordBreakdown(breakCipher, false, false)
	closeAllOpenedMenus()
	box.focus()
}

function profileDeleteEntry(id) {
	entriesDelete(id).then(function () {
		if (typeof histSyncLastHash !== "undefined") histSyncLastHash = null // let the sync notice
		renderProfileEntries()
	}).catch(function (err) { profileBody(profileErr(err)) })
}

// phrase -> why it was refused, so the row can stay red after the re-render
var profileSubmitRejected = {}

function profileSubmit(phrase) {
	delete profileSubmitRejected[phrase]
	submissionSubmit(phrase).then(function () {
		displayCalcNotification("Submitted to the leaderboard", 1800)
		renderProfileEntries()
	}).catch(function (err) {
		var msg = err.message || "Could not submit"
		// A refusal is a rule, not a glitch: mark the row red and say why, rather
		// than only flashing a notification that is gone a second later.
		profileSubmitRejected[phrase] = msg
		displayCalcNotification(msg, 2600)
		renderProfileEntries()
	})
}

// ---- presets ----------------------------------------------------------
//
// A preset is a whole named setup - which cyphers are enabled, their colours,
// any custom cyphers, and the code rain style and settings - saved so it can
// be switched back to in one click.

function renderProfilePresets() {
	var tok = profileRenderSeq
	presetsList().then(function (rows) {
		var o = ''
		o += '<div class="profileNote">A preset stores your enabled cyphers, colours, custom cyphers and code rain settings under a name. Loading one replaces what you have open now.</div>'

		o += '<div class="profileSearchRow">'
		o += '<input type="text" id="presetName" class="profileSearchInput" maxlength="60" placeholder="Name this setup&hellip;" onkeydown="if(event.key===\'Enter\'){profilePresetSave();return false}">'
		o += '<button class="profileMiniBtn" onclick="profilePresetSave()" title="Save the current setup under this name">Save</button>'
		o += '</div>'

		if (rows.length === 0) {
			o += '<div class="profileNote">No presets yet. Set the calculator up how you like it, type a name above and press Save.</div>'
			profileBody(o, tok); return
		}

		o += '<div class="profileList">'
		rows.forEach(function (r) {
			o += '<div class="profileRow">'
			o += '<span class="profileRowPhrase" onclick="profilePresetLoad(&quot;'+r.id+'&quot;)" title="Load this preset">'+authEsc(r.name)+'</span>'
			o += '<span class="profileRowActions">'
			o += '<span class="profileWhen">'+new Date(r.updated_at).toLocaleDateString()+'</span>'
			o += '<button class="profileMiniBtn" onclick="profilePresetLoad(&quot;'+r.id+'&quot;)">Load</button>'
			o += '<button class="profileMiniBtn" onclick="profilePresetOverwrite(&quot;'+authEsc(r.name).replace(/"/g,'&quot;')+'&quot;)" title="Replace this preset with the current setup">Overwrite</button>'
			o += '<button class="profileMiniBtn profileMiniDanger" onclick="profilePresetDelete(&quot;'+r.id+'&quot;,&quot;'+authEsc(r.name).replace(/"/g,'&quot;')+'&quot;)" title="Delete this preset">&#215;</button>'
			o += '</span></div>'
		})
		o += '</div>'
		profileBody(o, tok)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

function profilePresetSave() {
	var box = document.getElementById("presetName")
	var name = (box === null) ? "" : box.value.trim()
	if (name === "") { displayCalcNotification("Give the preset a name", 1800); return }
	presetSave(name).then(function (what) {
		displayCalcNotification(what === "updated" ? "Preset updated" : "Preset saved", 1800)
		renderProfilePresets()
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not save the preset", 2400)
	})
}

function profilePresetOverwrite(name) {
	presetSave(name).then(function () {
		displayCalcNotification("Preset updated", 1800)
		renderProfilePresets()
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not save the preset", 2400)
	})
}

// Loading rebuilds the whole calculator, which tears down and redraws the menu
// panel - so the profile panel is reopened afterwards rather than left as a
// stale fragment of the old DOM.
function profilePresetLoad(id) {
	presetLoad(id).then(function (name) {
		displayCalcNotification("Loaded preset: " + name, 2000)
		profileMenuOpened = false
		toggleProfileMenu()
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not load the preset", 2400)
	})
}

function profilePresetDelete(id, name) {
	if (!window.confirm('Delete the preset "' + name + '"?')) return
	presetDelete(id).then(renderProfilePresets)
		.catch(function (err) { profileBody(profileErr(err), tok) })
}

// ---- my submissions ---------------------------------------------------

function renderProfileSubmissions() {
	var tok = profileRenderSeq
	submissionsList(200).then(function (rows) {
		var o = ''
		o += '<div class="profileNote">Phrases you have published. Everyone signed in can see these, along with your display name.</div>'
		if (rows.length === 0) {
			o += '<div class="profileNote">Nothing published yet. Submit a phrase from the Saved Entries tab.</div>'
			profileBody(o, tok); return
		}
		o += '<div class="profileList">'
		rows.forEach(function (r) {
			o += '<div class="profileRow">'
			o += '<span class="profileRowPhrase" onclick="profileUsePhrase(&quot;'+authEsc(r.phrase).replace(/"/g,'&quot;')+'&quot;)">'+authEsc(r.phrase)+'</span>'
			o += '<span class="profileRowActions">'
			o += '<span class="profileWhen">'+new Date(r.created_at).toLocaleDateString()+'</span>'
			o += '<button class="profileMiniBtn profileMiniDanger" onclick="profileWithdraw(&quot;'+r.id+'&quot;)" title="Withdraw this submission">Withdraw</button>'
			o += '</span></div>'
		})
		o += '</div>'
		profileBody(o, tok)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

function profileWithdraw(id) {
	submissionWithdraw(id).then(renderProfileSubmissions)
		.catch(function (err) { profileBody(profileErr(err), tok) })
}

// ---- leaderboard ------------------------------------------------------

function renderProfileLeaderboard() {
	var tok = profileRenderSeq
	leaderboardTop(25).then(function (rows) {
		var o = ''
		o += '<div class="profileNote">Top contributors by phrases published. Display names only &mdash; email addresses are never shown.</div>'
		if (rows.length === 0) {
			o += '<div class="profileNote">Nobody has published a phrase yet. Be the first.</div>'
			profileBody(o, tok); return
		}
		o += '<div class="profileList">'
		rows.forEach(function (r, i) {
			var av = r.avatar
				? '<img class="profileLbAvatar" src="'+authEsc(r.avatar)+'" alt="">'
				: '<span class="profileLbAvatar profileLbFallback">'+authEsc(String(r.display_name).charAt(0).toUpperCase())+'</span>'
			o += '<div class="profileRow profileLbRow" onclick="profileShowContributor(&quot;'+r.user_id+'&quot;, &quot;'+authEsc(r.display_name).replace(/"/g,'&quot;')+'&quot;)">'
			o += '<span class="profileLbRank">'+(i+1)+'</span>'
			o += av
			o += '<span class="profileRowPhrase">'+authEsc(r.display_name)+'</span>'
			o += '<span class="profileRowActions"><span class="profileBadge">'+r.submissions+'</span></span>'
			o += '</div>'
		})
		o += '</div>'
		o += '<div id="profileContributor"></div>'
		profileBody(o, tok)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

function profileShowContributor(userId, name) {
	var host = document.getElementById("profileContributor")
	if (host === null) return
	host.innerHTML = '<div class="profileLoading">Loading…</div>'
	leaderboardPhrases(userId, 50).then(function (rows) {
		var o = '<div class="profileContribBox">'
		o += '<div class="profileContribTitle">Published by '+authEsc(name)+'</div>'
		if (rows.length === 0) o += '<div class="profileNote">Nothing to show.</div>'
		else {
			o += '<div class="profileChips">'
			rows.forEach(function (r) {
				o += '<span class="profileChip" onclick="profileUsePhrase(&quot;'+authEsc(r.phrase).replace(/"/g,'&quot;')+'&quot;)" title="Send to the calculator">'+authEsc(r.phrase)+'</span>'
			})
			o += '</div>'
		}
		o += '</div>'
		host.innerHTML = o
	}).catch(function (err) { host.innerHTML = profileErr(err) })
}

// ---- account ----------------------------------------------------------

function renderProfileAccount() {
	var av = authAvatarUrl()
	var o = ''
	o += '<div class="profileAccountHead">'
	o += av ? '<img class="profileBigAvatar" src="'+authEsc(av)+'" alt="">'
	        : '<div class="profileBigAvatar profileLbFallback">'+authEsc(authDisplayName().charAt(0).toUpperCase())+'</div>'
	o += '<div><div class="profileAccountName">'+authEsc(authDisplayName())+'</div>'
	o += '<div class="profileAccountSub">'+authEsc(authUser.email || "Discord account")+'</div></div>'
	o += '</div>'

	o += '<div class="profileNote">Profile picture &mdash; PNG, JPEG, WebP or GIF, up to 2 MB.</div>'
	o += '<div class="profileAvatarRow">'
	o += '<input type="file" id="profileAvatarFile" accept="image/png,image/jpeg,image/webp,image/gif" class="profileFileInput" onchange="profileAvatarPick()">'
	o += '<button class="profileMiniBtn" id="profileAvatarBtn" onclick="profileAvatarUpload()">Upload</button>'
	if (authProfile && authProfile.avatar_url) {
		o += '<button class="profileMiniBtn profileMiniDanger" onclick="profileAvatarRemove()">Remove</button>'
	}
	o += '</div>'
	o += '<div id="profileAvatarMsg" class="profileNote hideValue"></div>'

	o += '<div class="profileNote profileFoot">More settings, including your display name and saved history, are on the <a class="authLink" href="profile.html">full profile page</a>.</div>'
	profileBody(o)
}

function profileAvatarPick() {
	var f = document.getElementById("profileAvatarFile").files[0]
	var problem = avatarValidate(f)
	var msg = document.getElementById("profileAvatarMsg")
	msg.classList.toggle("hideValue", !problem)
	msg.className = "profileNote profileWarn" + (problem ? "" : " hideValue")
	msg.textContent = problem || ""
}

function profileAvatarUpload() {
	var f = document.getElementById("profileAvatarFile").files[0]
	var msg = document.getElementById("profileAvatarMsg")
	var show = function (t, warn) {
		msg.className = "profileNote" + (warn ? " profileWarn" : " profileOk")
		msg.textContent = t
		msg.classList.remove("hideValue")
	}
	var problem = avatarValidate(f)
	if (problem) { show(problem, true); return }

	document.getElementById("profileAvatarBtn").disabled = true
	show("Uploading…", false)
	avatarUpload(f).then(function () {
		document.getElementById("profileAvatarBtn").disabled = false
		renderAuthNav()
		renderProfileAccount()
		displayCalcNotification("Profile picture updated", 1800)
	}).catch(function (err) {
		document.getElementById("profileAvatarBtn").disabled = false
		show(err.message || "Upload failed", true)
	})
}

function profileAvatarRemove() {
	avatarRemove().then(function () {
		renderAuthNav()
		renderProfileAccount()
	}).catch(function (err) {
		var msg = document.getElementById("profileAvatarMsg")
		msg.className = "profileNote profileWarn"
		msg.textContent = err.message || "Could not remove"
		msg.classList.remove("hideValue")
	})
}

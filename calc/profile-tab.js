// ========================= Profile tab ============================
//
// Top-level panel for account features: your saved entries, phrases you have
// published, and the contributor leaderboard.
//
// Signed-out visitors get a sign-in prompt rather than a broken panel; the
// calculator itself never requires an account.

var profileMenuOpened = false
var profileTabActive = "presets" // presets first: it is the tab you act from
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
		// One button, same as the nav: signing in is the way in whether or not you
		// have an account yet, and the sign-in page offers to make you one.
		o += '<div class="profileSignedOutBtns">'
		o += '<a class="intBtn3 profileCta profileCtaPrimary" href="login.html">Sign in</a>'
		o += '</div></div></div>'
		area.innerHTML = o
		return
	}

	o += '<div class="profileTabs">'
	o += profileTabBtn("presets", "✅ Presets")
	o += profileTabBtn("csv", "📄 CSV")
	o += profileTabBtn("entries", "💾 Saved")
	o += profileTabBtn("submissions", "📤 Submit")
	o += profileTabBtn("leaderboard", "🏆 Leaders")
	o += profileTabBtn("friends", "📧 Friends")
	o += profileTabBtn("chart", "🔮 Chart")
	o += profileTabBtn("account", "⚙ Account")
	o += '</div>'

	o += '<div id="profileBody" class="profileBody"><div class="profileLoading">Loading…</div></div>'
	o += '</div>'
	area.innerHTML = o

	// anything still in flight from the previous tab is now stale
	profileRenderSeq++

	if (profileTabActive === "entries") renderProfileEntries()
	else if (profileTabActive === "presets") renderProfilePresets()
	else if (profileTabActive === "csv") renderProfileCsv()
	else if (profileTabActive === "chart") renderProfileChart()
	else if (profileTabActive === "submissions") renderProfileSubmissions()
	else if (profileTabActive === "leaderboard") renderProfileLeaderboard()
	else if (profileTabActive === "friends") renderProfileFriends()
	else renderProfileAccount()
}

function profileTabBtn(id, label) {
	var on = (profileTabActive === id) ? " profileTabOn" : ""
	var elId = "profileTab" + id.charAt(0).toUpperCase() + id.slice(1)
	return '<input class="intBtn3 profileTab'+on+'" id="'+elId+'" type="button" value="'+label+'" onclick="profileSetTab(&quot;'+id+'&quot;)">'
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

	// Push anything typed since the last sync before reading the list back.
	// The sync is on a timer, so without this a phrase entered moments ago is
	// simply not on the server yet and the tab looks like it has missed it -
	// which is why it took a second open to show up.
	var ready = (typeof histSyncFlush === "function") ? histSyncFlush() : Promise.resolve()

	ready.then(function () { return entriesSearch(term, 200) }).then(function (rows) {
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
					// the cipher arrives prefilled from whatever is selected, so
					// publishing stays one click unless you want to change it
					o += profileCipherSelect(r.id)
					o += '<button class="profileMiniBtn" onclick="profileSubmit(&quot;'+authEsc(r.phrase).replace(/"/g,'&quot;')+'&quot;,&quot;'+r.id+'&quot;)" title="Publish this phrase to the leaderboard">Submit</button>'
				}
				o += '<button class="profileMiniBtn profileMiniDanger" onclick="profileDeleteEntry(&quot;'+r.id+'&quot;,&quot;'+authEsc(r.phrase).replace(/"/g,'&quot;')+'&quot;)" title="Remove from your saved history">&#215;</button>'
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

// Loads a phrase into the input and stops there.
//
// It used to recompute the enabled-cipher summary and the word breakdown as
// well, which rewrote the workspace to describe a phrase the user had only
// clicked on, not entered. Nothing is committed until they press Enter, so
// nothing else should move: the history table, its Find Matches ordering and
// the current breakdown all stay exactly as they were.
// Turns on the cipher a leaderboard entry was published in, so the value on the
// chip is one you can actually see. Returns false when the cipher no longer
// exists, which is possible for an old submission.
function profileEnableCipher(name) {
	if (!name || typeof cipherList === "undefined") return false
	for (var i = 0; i < cipherList.length; i++) {
		if (cipherList[i].cipherName !== name) continue
		if (!cipherList[i].enabled) {
			cipherList[i].enabled = true
			var box = document.getElementById("cipher_chkbox" + i)
			if (box !== null) box.checked = true
			if (typeof updateTables === "function") updateTables()
		}
		return true
	}
	return false
}

function profileUsePhrase(p, keepPanel, cipher) {
	var box = document.getElementById("phraseBox")
	if (box === null) return
	box.value = p

	// Enabling the cipher is the one thing that does move the workspace, and
	// deliberately: without it the entry says 74 and the calculator shows a
	// column that cannot produce it. Recomputing the summary is what makes the
	// number appear against the phrase now sitting in the box.
	var shown = false
	if (cipher) {
		shown = profileEnableCipher(cipher)
		if (shown && typeof updateEnabledCipherTable === "function") updateEnabledCipherTable()
	}
	// Browsing someone's contributions is a list you work through, so picking
	// one leaves the leaderboard up rather than closing the panel out from
	// under you. Everywhere else, closing puts the input back in reach.
	if (!keepPanel) {
		closeAllOpenedMenus()
		box.focus()
		box.select()
	}
	var msg = "Loaded: " + p + " — press Enter to add it"
	if (shown) msg = "Loaded: " + p + " — " + cipher + " is on, press Enter to add it"
	displayCalcNotification(msg, 2200)
}

// Deleting the row on its own does not stick. The sync mirrors the local
// history table up to the server, so a phrase still sitting in sHistory is
// simply re-uploaded on the next pass and the entry reappears - which is why
// saved entries could not be deleted at all. Clearing histSyncLastHash made it
// worse by forcing that pass to run immediately.
//
// So the phrase goes from the local history first, and the row follows.
function profileDeleteEntry(id, phrase) {
	if (typeof sHistory !== "undefined" && phrase !== undefined) {
		var keep = []
		for (var i = 0; i < sHistory.length; i++) {
			if (sHistory[i] !== phrase) keep.push(sHistory[i])
		}
		if (keep.length !== sHistory.length) {
			sHistory = keep
			if (typeof updateHistoryTable === "function") updateHistoryTable()
		}
	}
	entriesDelete(id).then(function () {
		renderProfileEntries()
	}).catch(function (err) { profileBody(profileErr(err)) })
}

// A cipher picker for one row, preselected to whatever is currently active so
// the usual case is still a single click. Enabled ciphers are listed first
// because they are the ones being worked in.
//
// A plain <select> of two hundred-odd ciphers is only usable if you already
// know where yours sits in the list, so this is a text box that filters as you
// type. It keeps the id the Submit button reads, and it can only ever hold a
// real cipher name: profileCiphCommit() snaps anything else back.
function profileCipherSelect(rowId) {
	if (typeof cipherList === "undefined") return ""
	var pick = (typeof submissionCipherDefault === "function") ? submissionCipherDefault() : null
	if (!pick && cipherList.length) pick = cipherList[0].cipherName

	var o = '<span class="profileCiphPick">'
	o += '<input type="text" class="profileCiphSelect profileCiphInput" id="ciph_'+rowId+'"'
	o += ' value="'+authEsc(pick || "")+'" data-valid="'+authEsc(pick || "")+'"'
	o += ' autocomplete="off" spellcheck="false" placeholder="Type to search…"'
	o += ' title="Which cypher makes this interesting? Type to search.">'
	o += '</span>'
	return o
}

// ---- searchable cipher picker -----------------------------------------
//
// One menu, moved to whichever box has focus, and parented to <body> rather
// than to the row: the saved-entries list is a 340px scroll box, so a menu
// living inside it would be cut off on every row near the bottom.

var profileCiphInput = null // the box the open menu belongs to

function profileCiphSets() {
	var on = [], off = []
	if (typeof cipherList === "undefined") return { on: on, off: off, all: [] }
	for (var i = 0; i < cipherList.length; i++) {
		(cipherList[i].enabled ? on : off).push(cipherList[i].cipherName)
	}
	return { on: on, off: off, all: on.concat(off) }
}

// the part you typed, shown in bold inside each name
function profileCiphMark(name, q) {
	if (q === "") return authEsc(name)
	var i = name.toLowerCase().indexOf(q)
	if (i < 0) return authEsc(name)
	return authEsc(name.slice(0, i)) + '<b>' + authEsc(name.slice(i, i + q.length)) + '</b>' + authEsc(name.slice(i + q.length))
}

function profileCiphMenuHtml(term) {
	var sets = profileCiphSets()
	var q = String(term || "").trim().toLowerCase()
	var o = ""

	var group = function (label, arr) {
		var hits = []
		for (var i = 0; i < arr.length; i++) {
			if (q === "" || arr[i].toLowerCase().indexOf(q) > -1) hits.push(arr[i])
		}
		if (hits.length === 0) return
		o += '<div class="profileCiphGroup">'+authEsc(label)+'</div>'
		for (var n = 0; n < hits.length; n++) {
			o += '<div class="profileCiphOpt" data-name="'+authEsc(hits[n])+'">'+profileCiphMark(hits[n], q)+'</div>'
		}
	}
	group("On now", sets.on)
	group("All cyphers", sets.off)

	if (o === "") o = '<div class="profileCiphNone">No cypher matches that</div>'
	return o
}

function profileCiphPlace() {
	var m = document.getElementById("profileCiphMenu")
	if (m === null || profileCiphInput === null) return
	var r = profileCiphInput.getBoundingClientRect()
	m.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 210)) + "px"
	m.style.width = Math.max(r.width, 200) + "px"

	// open upwards when the box is near the bottom of the window
	var below = window.innerHeight - r.bottom
	if (below < 160 && r.top > below) {
		m.style.top = "auto"
		m.style.bottom = (window.innerHeight - r.top + 2) + "px"
		m.style.maxHeight = Math.min(240, r.top - 8) + "px"
	} else {
		m.style.bottom = "auto"
		m.style.top = (r.bottom + 2) + "px"
		m.style.maxHeight = Math.min(240, below - 8) + "px"
	}
}

function profileCiphOpen(input, term) {
	profileCiphInput = input
	var m = document.getElementById("profileCiphMenu")
	if (m === null) {
		m = document.createElement("div")
		m.id = "profileCiphMenu"
		m.className = "profileCiphMenu"
		document.body.appendChild(m)
	}
	m.innerHTML = profileCiphMenuHtml(term)
	m.scrollTop = 0
	profileCiphPlace()
}

function profileCiphClose() {
	$("#profileCiphMenu").remove()
	profileCiphInput = null
}

function profileCiphMove(dir) {
	var opts = $("#profileCiphMenu .profileCiphOpt")
	if (opts.length === 0) return
	var i = opts.index(opts.filter(".profileCiphOn"))
	i = (i < 0) ? (dir > 0 ? 0 : opts.length - 1) : i + dir
	if (i < 0) i = opts.length - 1
	if (i >= opts.length) i = 0

	opts.removeClass("profileCiphOn")
	var el = opts.eq(i).addClass("profileCiphOn")[0]
	var m = document.getElementById("profileCiphMenu")
	if (m !== null) { // keep the highlighted row inside the scroll box
		if (el.offsetTop < m.scrollTop) m.scrollTop = el.offsetTop
		else if (el.offsetTop + el.offsetHeight > m.scrollTop + m.clientHeight) {
			m.scrollTop = el.offsetTop + el.offsetHeight - m.clientHeight
		}
	}
}

function profileCiphPick(name) {
	if (profileCiphInput === null || !name) return
	profileCiphInput.value = name
	profileCiphInput.setAttribute("data-valid", name)
	profileCiphClose()
}

// Whatever is in the box when it loses focus has to be a real cipher, because
// Submit sends it straight on. An exact name wins, then the first thing the
// text matches, and failing both it goes back to the last good value.
function profileCiphCommit(input) {
	if (!input) return
	var names = profileCiphSets().all
	var v = input.value.trim().toLowerCase()
	var exact = null, first = null
	for (var i = 0; i < names.length; i++) {
		if (names[i].toLowerCase() === v) { exact = names[i]; break }
		if (first === null && v !== "" && names[i].toLowerCase().indexOf(v) > -1) first = names[i]
	}
	var pick = exact || first || input.getAttribute("data-valid") || names[0] || ""
	input.value = pick
	input.setAttribute("data-valid", pick)
}

$(document).ready(function () {
	$(document).on("focus", ".profileCiphInput", function () {
		profileCiphOpen(this, "") // the whole list, so it works as a plain dropdown too
		this.select()             // and typing replaces the current pick
	})
	$(document).on("input", ".profileCiphInput", function () {
		profileCiphOpen(this, this.value)
	})
	$(document).on("keydown", ".profileCiphInput", function (e) {
		var k = e.key
		if (k === "ArrowDown" || k === "Down") {
			e.preventDefault()
			if ($("#profileCiphMenu").length === 0) profileCiphOpen(this, this.value)
			profileCiphMove(1)
		} else if (k === "ArrowUp" || k === "Up") {
			e.preventDefault()
			profileCiphMove(-1)
		} else if (k === "Enter") {
			e.preventDefault()
			var sel = $("#profileCiphMenu .profileCiphOpt.profileCiphOn")
			if (sel.length) profileCiphPick(sel.attr("data-name"))
			else { profileCiphClose(); profileCiphCommit(this) }
		} else if (k === "Escape" || k === "Esc") {
			profileCiphClose()
			profileCiphCommit(this)
		}
	})
	$(document).on("blur", ".profileCiphInput", function () {
		var input = this
		// a click on an option has to land before the menu goes
		setTimeout(function () {
			if (profileCiphInput === input) profileCiphClose()
			profileCiphCommit(input)
		}, 150)
	})
	// mousedown, not click: click arrives after blur has already closed the menu
	$(document).on("mousedown", "#profileCiphMenu .profileCiphOpt", function (e) {
		e.preventDefault() // keep focus in the box
		profileCiphPick($(this).attr("data-name"))
	})
	$(document).on("mouseenter", "#profileCiphMenu .profileCiphOpt", function () {
		$("#profileCiphMenu .profileCiphOpt").removeClass("profileCiphOn")
		$(this).addClass("profileCiphOn")
	})
	// the menu is positioned against the box, so anything that moves the box
	// closes it rather than leaving it floating somewhere wrong
	$(document).on("scroll", ".profileList", profileCiphClose)
	$(window).on("resize", profileCiphClose)
})

// phrase -> why it was refused, so the row can stay red after the re-render
var profileSubmitRejected = {}

function profileSubmit(phrase, rowId) {
	delete profileSubmitRejected[phrase]
	var sel = (rowId !== undefined) ? document.getElementById("ciph_" + rowId) : null
	var cipherName = (sel !== null) ? sel.value : undefined
	submissionSubmit(phrase, cipherName).then(function () {
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

// ---- confirming a destructive click ------------------------------------
//
// window.confirm() is suppressed in ordinary use - a browser told to stop a
// page opening dialogs returns false immediately without asking - so every
// delete button that leant on it silently did nothing.
//
// The confirmation lives in the page instead: the first click arms the button
// and the second carries it out. Nothing outside this file can switch it off,
// and it behaves the same on a phone.
var profileArmedBtn = null
var profileArmedTimer = null

function profileDisarm() {
	if (profileArmedBtn !== null) {
		profileArmedBtn.innerHTML = profileArmedBtn.dataset.idleLabel || "&#215;"
		profileArmedBtn.classList.remove("profileArmed")
		profileArmedBtn = null
	}
	clearTimeout(profileArmedTimer)
}

// Returns true when the click should go through.
function profileConfirmClick(btn, label) {
	if (btn === profileArmedBtn) { profileDisarm(); return true }
	profileDisarm()
	profileArmedBtn = btn
	btn.dataset.idleLabel = btn.innerHTML
	btn.textContent = label || "Sure?"
	btn.classList.add("profileArmed")
	// disarms itself, so a stray click is never left primed
	profileArmedTimer = setTimeout(profileDisarm, 4000)
	return false
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
		// One line at the panel's width. "under a name" went: it ran 10px over,
		// which stranded "open." on a line of its own, and the naming field
		// directly below makes the point anyway.
		o += '<div class="profileNote profileNoteOneLine">&#128190; Saves your cyphers, colours and code rain. &#128260; Loading one replaces what you have open.</div>'

		// A way back to the state the calculator ships in, without needing a
		// preset saved for it. Nothing stored is touched - this only resets what
		// is open.
		o += '<div class="profileDefaultRow">'
		o += '<button class="profileMiniBtn profileDefaultBtn" onclick="profilePresetDefaults(this)" title="Base-4 cyphers and the stock code rain">&#8634; Back to defaults</button>'
		o += '<span class="profileWhen">&#9989; Base-4 and stock rain. Saved presets untouched.</span>'
		o += '</div>'

		o += '<div class="profileSearchRow profilePresetSaveRow">'
		o += '<input type="text" id="presetName" class="profileSearchInput" maxlength="60" placeholder="&#127991; Name this setup&hellip;" onkeydown="if(event.key===\'Enter\'){profilePresetSave();return false}">'
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
			o += '<button class="profileMiniBtn profileMiniDanger" onclick="profilePresetDelete(this,&quot;'+r.id+'&quot;)" title="Delete this preset">&#215;</button>'
			o += '</span></div>'
		})
		o += '</div>'
		profileBody(o, tok)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

// Restores the calculator to how it arrives on a first visit: the built-in
// base-4 cyphers and the stock code rain. Deliberately not a saved preset -
// there is nothing to lose if it is never saved, and nothing to go stale.
function profilePresetDefaults(btn) {
	if (!profileConfirmClick(btn, "Reset?")) return

	if (typeof enableDefaultCiphers === "function") enableDefaultCiphers()
	if (typeof coderainResetIntensity === "function") coderainResetIntensity()
	if (typeof coderainStyle !== "undefined") {
		coderainStyle = "new"
		optMatrixCodeRain = true
		if (typeof toggleCodeRain === "function") toggleCodeRain()
	}
	if (typeof updateTables === "function") updateTables()
	if (typeof wsSyncLastHash !== "undefined") wsSyncLastHash = null // let the sync notice

	displayCalcNotification("Back to the default cyphers and code rain", 2200)
	renderProfilePresets()
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

function profilePresetDelete(btn, id) {
	if (!profileConfirmClick(btn)) return
	presetDelete(id).then(renderProfilePresets)
		.catch(function (err) { profileBody(profileErr(err)) })
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
			if (r.cipher) {
				o += '<span class="profileBadge" title="Published under this cypher">'+authEsc(r.cipher)+(r.value !== null && r.value !== undefined ? ' ' + r.value : '')+'</span>'
			}
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
		.catch(function (err) { profileBody(profileErr(err)) })
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
			o += '<div class="profileRow profileLbRow" data-uid="'+r.user_id+'" onclick="profileShowContributor(&quot;'+r.user_id+'&quot;, &quot;'+authEsc(r.display_name).replace(/"/g,'&quot;')+'&quot;)">'
			o += '<span class="profileLbRank">'+(i+1)+'</span>'
			o += av
			o += '<span class="profileRowPhrase">'+authEsc(r.display_name)+'</span>'
			o += '<span class="profileRowActions"><span class="profileBadge">'+r.submissions+'</span></span>'
			o += '</div>'
		})
		o += '</div>'
		o += '<div id="profileContributor"></div>'
		profileBody(o, tok)
		profileContribOpen = null // the panel below was just thrown away with it
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

// Whose submissions are showing, so the same name can close them again.
var profileContribOpen = null

// The colour the calculator already gives this cipher, so a leaderboard entry
// and the column it came from read as the same thing.
function profileCipherColor(name) {
	if (!name || typeof cipherList === "undefined") return null
	for (var i = 0; i < cipherList.length; i++) {
		if (cipherList[i].cipherName === name) {
			return 'hsl('+cipherList[i].H+' '+cipherList[i].S+'% '+cipherList[i].L+'%)'
		}
	}
	return null // a cipher that has since been renamed or removed
}

function profileMarkOpenContributor() {
	$(".profileLbRow").each(function () {
		$(this).toggleClass("profileLbOpen", $(this).attr("data-uid") === profileContribOpen)
	})
}

function profileShowContributor(userId, name) {
	var host = document.getElementById("profileContributor")
	if (host === null) return

	// A name is a switch, not a radio button: clicking the one already open
	// closes it. It used to take opening somebody else to get rid of a list,
	// which left no way to put the leaderboard back the way you found it.
	if (profileContribOpen === userId) {
		profileContribOpen = null
		profileMarkOpenContributor()
		host.innerHTML = ""
		return
	}

	profileContribOpen = userId
	profileMarkOpenContributor()
	host.innerHTML = '<div class="profileLoading">Loading…</div>'
	leaderboardPhrases(userId, 50).then(function (rows) {
		if (profileContribOpen !== userId) return // closed, or another name opened, while this loaded
		var o = '<div class="profileContribBox">'
		o += '<div class="profileContribTitle">Published by '+authEsc(name)+'</div>'
		if (rows.length === 0) o += '<div class="profileNote">Nothing to show.</div>'
		else {
			o += '<div class="profileChips">'
			rows.forEach(function (r) {
				var hasVal = (r.value !== null && r.value !== undefined)
				var why = r.cipher
					? (r.cipher + (hasVal ? ' = ' + r.value : '') + ' — send to the calculator')
					: 'Send to the calculator'
				var arg = function (s) { return authEsc(String(s)).replace(/"/g,'&quot;') }
				o += '<span class="profileChip" title="'+authEsc(why)+'"'
				o += ' onclick="profileUsePhrase(&quot;'+arg(r.phrase)+'&quot;, true, &quot;'+arg(r.cipher || "")+'&quot;)">'
				o += '<span class="profileChipTerm">'+authEsc(r.phrase)+'</span>'
				if (r.cipher) {
					// the cipher's own colour, so the pair carries the same
					// meaning here as it does in the History Table
					var col = profileCipherColor(r.cipher)
					o += '<span class="profileChipCiph"'+(col ? ' style="color:'+col+'"' : '')+'>'
					o += authEsc(r.cipher)
					if (hasVal) o += ' <span class="profileChipVal">'+authEsc(String(r.value))+'</span>'
					o += '</span>'
				}
				o += '</span>'
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
	// The picture is a button. Clicking it opens the choices; the file input
	// itself is never on show, because "Choose file / no file chosen" is the
	// browser's widget, not ours, and it says nothing useful sitting there.
	o += '<div class="profileAccountHead">'
	o += '<button type="button" class="profileAvatarPick" onclick="profileAvatarMenu(true)" title="Change your picture">'
	o += av ? '<img class="profileBigAvatar" src="'+authEsc(av)+'" alt="">'
	        : '<div class="profileBigAvatar profileLbFallback">'+authEsc(authDisplayName().charAt(0).toUpperCase())+'</div>'
	o += '<span class="profileAvatarOverlay">Change</span>'
	o += '</button>'
	o += '<div><div class="profileAccountName">'+authEsc(authDisplayName())+'</div>'
	o += '<div class="profileAccountSub">'+authEsc(authUser.email || "Discord account")+'</div></div>'
	o += '</div>'

	// hidden until the picture is clicked
	o += '<div id="profileAvatarOpts" class="profileAvatarOpts hideValue">'
	o += '<div class="profileNote">PNG, JPEG, WebP or GIF. Large photos are resized for you.</div>'
	o += '<div class="profileAvatarRow">'
	o += '<button class="profileMiniBtn" id="profileAvatarBtn" onclick="profileAvatarBrowse()">Upload a picture</button>'
	if (authProfile && authProfile.avatar_url) {
		o += '<button class="profileMiniBtn profileMiniDanger" onclick="profileAvatarRemove()">Remove current</button>'
	}
	o += '<button class="profileMiniBtn" onclick="profileAvatarMenu(false)">Cancel</button>'
	o += '</div></div>'
	o += '<input type="file" id="profileAvatarFile" accept="image/png,image/jpeg,image/webp,image/gif" class="hideValue" onchange="profileAvatarPickAndUpload()">'
	o += '<div id="profileAvatarMsg" class="profileNote hideValue"></div>'

	// display name lives here now that the panel is the whole profile, rather
	// than sending people off to a separate page for one field
	o += '<div class="profileNameRow">'
	o += '<label class="contactLabel" for="profileDisplayName">Display name</label>'
	o += '<div class="profileSearchRow">'
	o += '<input type="text" id="profileDisplayName" class="profileSearchInput" maxlength="32" placeholder="Shown on the leaderboard" value="'+authEsc((authProfile && authProfile.username) ? authProfile.username : "")+'">'
	o += '<button class="profileMiniBtn" onclick="profileSaveName()">Save</button>'
	o += '</div>'
	o += '<div id="profileNameMsg" class="profileNote hideValue"></div>'
	o += '</div>'

	// Closing the account. Deliberately last, visually separated, and asks for
	// the word to be typed rather than relying on a single click - this cannot
	// be undone and there is no backup to restore from.
	o += '<div class="profileDanger">'
	o += '<div class="profileDangerTitle">Close your account</div>'
	o += '<div class="profileNote">This permanently deletes your account and everything attached to it: your email and login, saved history, workspace, presets, published phrases and profile picture. It cannot be undone.</div>'
	o += '<div class="profileDangerRow">'
	o += '<input type="text" id="profileDeleteConfirm" class="profileSearchInput" placeholder="Type DELETE to confirm" autocomplete="off" spellcheck="false" oninput="profileDeleteGate()">'
	o += '<button class="profileMiniBtn profileMiniDanger" id="profileDeleteBtn" onclick="profileDeleteAccount()" disabled>Delete my account</button>'
	o += '</div>'
	o += '<div id="profileDeleteMsg" class="profileNote hideValue"></div>'
	o += '</div>'

	profileBody(o)
}

// The button only wakes up once the word is typed exactly.
function profileDeleteGate() {
	var box = document.getElementById("profileDeleteConfirm")
	var btn = document.getElementById("profileDeleteBtn")
	if (box === null || btn === null) return
	btn.disabled = (box.value.trim().toUpperCase() !== "DELETE")
}

function profileDeleteAccount() {
	var box = document.getElementById("profileDeleteConfirm")
	if (box === null || box.value.trim().toUpperCase() !== "DELETE") return
	// no window.confirm here: suppressed in ordinary use, it returns false and
	// would block the deletion outright. Typing the word is the gate.

	var btn = document.getElementById("profileDeleteBtn")
	var msg = document.getElementById("profileDeleteMsg")
	if (btn !== null) btn.disabled = true
	if (msg !== null) {
		msg.className = "profileNote"
		msg.textContent = "Deleting…"
		msg.classList.remove("hideValue")
	}

	accountDelete().then(function () {
		window.location.href = "index.html"
	}).catch(function (err) {
		if (msg !== null) {
			msg.className = "profileNote profileWarn"
			msg.textContent = (err && err.message) ? err.message : "Could not delete the account"
		}
		if (btn !== null) btn.disabled = false
	})
}

// Shows or hides the picture options. They start hidden so the account tab is
// just the picture and the name until you ask to change it.
function profileAvatarMenu(show) {
	var el = document.getElementById("profileAvatarOpts")
	if (el !== null) el.classList.toggle("hideValue", !show)
}

function profileAvatarBrowse() {
	document.getElementById("profileAvatarFile").click()
}

// Picking a file uploads it. Choosing a picture and then having to press a
// second button is a step with no decision in it.
function profileAvatarPickAndUpload() {
	var f = document.getElementById("profileAvatarFile").files[0]
	if (!f) return
	profileAvatarUpload()
}

// Saves the name shown on the leaderboard and beside the avatar.
function profileSaveName() {
	var box = document.getElementById("profileDisplayName")
	var msg = document.getElementById("profileNameMsg")
	if (box === null) return
	var show = function (t, warn) {
		msg.className = "profileNote" + (warn ? " profileWarn" : " profileOk")
		msg.textContent = t
		msg.classList.remove("hideValue")
	}
	var name = box.value.trim()
	if (name.length > 0 && (name.length < 2 || name.length > 32)) {
		show("Use between 2 and 32 characters.", true); return
	}
	updateProfile({ username: name === "" ? null : name }).then(function () {
		show("Saved.", false)
		renderAuthNav()
	}).catch(function (err) {
		var m = (err && err.message) ? err.message : "Could not save"
		if (m.toLowerCase().indexOf("duplicate") > -1) m = "That name is taken."
		show(m, true)
	})
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

// ---- saved CSVs -------------------------------------------------------
//
// The History Table kept as the app's own CSV, so a saved copy loads back
// through the ordinary import path rather than a second reader.

function renderProfileCsv() {
	var tok = profileRenderSeq
	csvList().then(function (rows) {
		var count = (typeof sHistory !== "undefined") ? sHistory.length : 0
		var o = ''
		o += '<div class="profileNote">Save the History Table as a CSV against your account, and load it back whenever you want. Load adds the saved phrases to the table you have open; Replace clears it first.</div>'

		o += '<div class="profileSearchRow">'
		o += '<input type="text" id="csvName" class="profileSearchInput" maxlength="60" placeholder="Name this CSV&hellip;" onkeydown="profileCsvNameKey(event)">'
		o += '<button class="profileMiniBtn" onclick="profileCsvSave()"' + (count === 0 ? ' disabled title="The History Table is empty"' : '') + '>Save ' + count + ' row' + (count === 1 ? '' : 's') + '</button>'
		o += '</div>'

		if (rows.length === 0) {
			o += '<div class="profileNote">Nothing saved yet.</div>'
			profileBody(o, tok); return
		}

		o += '<div class="profileList">'
		rows.forEach(function (r) {
			var nm = authEsc(r.name).replace(/"/g, '&quot;')
			o += '<div class="profileRow">'
			o += '<span class="profileRowPhrase" onclick="profileCsvLoad(&quot;' + r.id + '&quot;,false)" title="Load into the History Table">' + authEsc(r.name) + '</span>'
			o += '<span class="profileRowActions">'
			o += '<span class="profileWhen">' + r.rows + ' rows</span>'
			o += '<button class="profileMiniBtn" onclick="profileCsvLoad(&quot;' + r.id + '&quot;,false)">Load</button>'
			o += '<button class="profileMiniBtn" onclick="profileCsvLoad(&quot;' + r.id + '&quot;,true)" title="Clear the table first, then load">Replace</button>'
			o += '<button class="profileMiniBtn" onclick="profileCsvDownload(&quot;' + r.id + '&quot;)" title="Download as a file">&#8595;</button>'
			o += '<button class="profileMiniBtn profileMiniDanger" onclick="profileCsvDelete(this,&quot;' + r.id + '&quot;)">&#215;</button>'
			o += '</span></div>'
		})
		o += '</div>'
		profileBody(o, tok)
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

function profileCsvNameKey(e) {
	if (e.key === "Enter") { e.preventDefault(); profileCsvSave() }
}

function profileCsvSave() {
	var box = document.getElementById("csvName")
	var name = (box === null) ? "" : box.value.trim()
	if (name === "") { displayCalcNotification("Give the CSV a name", 1800); return }
	if (typeof sHistory === "undefined" || sHistory.length === 0) {
		displayCalcNotification("The History Table is empty", 1800); return
	}
	var text = buildHistoryCSV(sHistory)
	csvSave(name, text, sHistory.length).then(function (what) {
		displayCalcNotification(what === "updated" ? "CSV updated" : "CSV saved", 1800)
		renderProfileCsv()
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not save", 2400)
	})
}

function profileCsvLoad(id, clearFirst) {
	csvLoad(id).then(function (row) {
		if (clearFirst) {
			sHistory = []
			if (typeof histDisplayOrder !== "undefined") histDisplayOrder = null
		}
		importFileAction(row.csv, true) // the app's own CSV reader, given the text directly
		closeAllOpenedMenus()
		displayCalcNotification("Loaded " + row.name, 2000)
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not load", 2400)
	})
}

function profileCsvDownload(id) {
	csvLoad(id).then(function (row) {
		download(row.name.replace(/[^\w.-]+/g, "_") + ".txt",
			'data:text/plain;charset=utf-8,' + encodeURIComponent(row.csv))
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not download", 2400)
	})
}

function profileCsvDelete(btn, id) {
	if (!profileConfirmClick(btn)) return
	csvDelete(id).then(renderProfileCsv)
		.catch(function (err) { profileBody(profileErr(err)) })
}

// Birth charts live in profile-chart.js: the tab grew its own inputs, two
// zodiacs and a transit list, which is more than belongs in here.


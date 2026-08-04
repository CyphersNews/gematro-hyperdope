// ========================= Local Storage ==========================

function saveCalcSettingsLocalStorage(saveDef = false) {
	var calcSetStr = exportCiphersDB(true) // export all ciphers
	if (!saveDef) {
		window.localStorage.setItem('userCalcSettings', calcSetStr);
		displayCalcNotification("Settings were saved!", 1500)
	} else {
		if (window.localStorage.getItem('defCalcSettings') === null) {
			window.localStorage.setItem('defCalcSettings', calcSetStr);
		}
	}
}

function restoreCalcSettingsLocalStorage(silentMode = false) {
	if (window.localStorage.getItem('userCalcSettings') === null) {
		if (window.localStorage.getItem('defCalcSettings').length > 0) {
			sItem = "defCalcSettings" // restore default settings if no user settings found
		} else { return }
	} else {
		sItem = "userCalcSettings" // restore user settings
	}
	return applyCalcSettingsString(window.localStorage.getItem(sItem), silentMode)
}

// Applies a settings blob in the format produced by exportCiphersDB(true).
// Split out of restoreCalcSettingsLocalStorage so the saved-workspace feature
// can reuse exactly the same import path rather than duplicating it.
//
// Note this eval()s the cipher definitions, which is how the existing import
// and localStorage restore have always worked. That is only safe because the
// string can only ever come from the user themselves: localStorage, a file
// they chose, or their own workspace row, which RLS restricts to auth.uid().
function applyCalcSettingsString(file, silentMode = false) {
	if (typeof file !== "string" || file.length === 0) return false

	var calcOpt = file.match(/(?<=calcOptions = )[\s\S]*?\]/m) // array values
	if (calcOpt !== null) {
		// Parsed as-is rather than having its whitespace stripped first. JSON.parse
		// already ignores the formatting between tokens, and the strip reached
		// inside the values too - a caption written "two  spaces" came back as
		// "two spaces". Harmless while options never restored; not once they do.
		calcOptMatch = calcOpt[0]
		if (isJsonString(calcOptMatch)) {
			importCalcOptions(JSON.parse(calcOptMatch)) // load user options
		} else {
			// Skipping this quietly is how a malformed options block went unnoticed
			// for so long: ciphers restored, every option silently did not. Blobs
			// written before the exporter was fixed still land here, and are
			// replaced the next time settings are saved.
			console.warn("Settings restored without options: the calcOptions block did not parse.")
		}
	}

	var ciph = file.match(/(?<=cipherList = \[)[\s\S]+/m) // match after "cipherList = [" till end of file, multiple line regex - [\s\S]+
	if (ciph === null) return false // not a settings blob, leave the app alone
	file = ciph[0].replace(/(\t|  +|\r|\n)/g, "").slice(10,-1) // remove tabs, consequtive spaces, line breaks - "new cipher" at start, last bracket
	ciph = file.split(",new cipher") // split string into array

	cipherList = []; cCat = []; defaultCipherArray = [] // clear arrays with previously defined ciphers, categories, default ciphers
	for (n = 0; n < ciph.length; n++) {
		cipherList.push(eval("new cipher("+ciph[n].slice(1,-1)+")")) // remove parethesis, evaluate string as javascript code
	}
	// a stored blob only knows the ciphers that existed when it was saved, so
	// anything shipped since is added back before ordering runs
	if (typeof mergeBuiltinCiphers === "function") mergeBuiltinCiphers()
	// a restored workspace arrives in whatever order it was saved in, so category
	// grouping, blank-category cleanup and alphabetical sorting are reapplied here
	if (typeof applyCipherOrdering === "function") applyCipherOrdering()
	document.getElementById("calcOptionsPanel").innerHTML = "" // clear menu panel
	initCalc(false, true) // reinit, keeping the cipher selection just restored
	updateTables() // update tables
	updateInterfaceColor(true) // update interface color (first run)
	// a restored blob can carry a picked rain colour, which drives the backdrop
	if (typeof coderainApplyBackdrop === "function") coderainApplyBackdrop()
	if (userDBlive.length !== 0) { // restore controls if live database is loaded
		$("#queryDBbtn").removeClass("hideValue") // display query button
		$("#clearDBqueryBtn").removeClass("hideValue") // clear button
		$("#unloadDBBtn").removeClass("hideValue") // unload database button
		$("#btn-export-db-query").removeClass("hideValue") // export button
		$("#liveDBOption").addClass("hideValue") // hide "Live Database Mode"
	}

	if (!silentMode) {
		displayCalcNotification("Settings were restored!", 1500)
	}
	return true
}

function clearCalcSettingsLocalStorage() {
	if (window.localStorage.getItem('userCalcSettings') === null) {
		window.localStorage.clear() // clear all localStorage
		displayCalcNotification("localStorage was cleared!", 1500)
		return
	}
	window.localStorage.removeItem('userCalcSettings');
	displayCalcNotification("Settings were cleared!", 1500)
	return
}
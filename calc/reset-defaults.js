// ===================== Reset to defaults =====================
//
// One way back to a known-good calculator: the shipped cyphers, the shipped
// options, and no Find Matches filter left running. Reachable two ways - by
// reloading the page twice, and from the right-click menu.
//
// The code rain is deliberately left alone. It is the one thing people tune to
// taste and then leave, and it is never the reason someone wants to start over,
// so a reset that wiped it would cost more than it fixed.
//
// This file must load after every script that declares an option variable
// (calc.js, encoding.js, coderain.js) and before anything that restores saved
// settings, because the snapshot below is taken while the values are still the
// ones the app shipped with.

// Option names kept as they are. These are exactly the code rain entries of
// calcOptionsArr; the interface and font colours are not among them, so a reset
// does put the theme back to the default blue.
var resetKeepOptions = [
	"optMatrixCodeRain",
	"optCoderainFollowCipher",
	"coderainStyle",
	"coderainDensity",
	"coderainSpeedMul",
	"coderainHue",
	"coderainSat",
	"coderainLit",
	"coderainColorPicked"
]

// The shipped option values, in the same "name = value" form importCalcOptions
// consumes. Captured once, at parse time, so it survives every later restore.
var calcFactoryOptions = null

function captureFactoryOptions() {
	if (calcFactoryOptions !== null) return calcFactoryOptions
	if (typeof exportCalcOptions !== "function" || typeof isJsonString !== "function") return null
	try {
		var m = exportCalcOptions().match(/(?<=calcOptions = )[\s\S]*?\]/m)
		if (m !== null && isJsonString(m[0])) calcFactoryOptions = JSON.parse(m[0])
	} catch (e) {
		console.warn("could not capture the default options:", e.message || e)
	}
	return calcFactoryOptions
}
captureFactoryOptions()

// ---- the reset itself --------------------------------------------------

function resetCalcToDefaults(silent) {
	var defaults = captureFactoryOptions()

	// 1. options, minus the code rain ones
	if (defaults !== null) {
		var keep = []
		for (var i = 0; i < defaults.length; i++) {
			var name = String(defaults[i]).split(" = ")[0]
			if (resetKeepOptions.indexOf(name) === -1) keep.push(defaults[i])
		}
		importCalcOptions(keep)
	}

	// 2. any Find Matches filter still running. removeActiveFilter() is not used
	// here: it puts back the cyphers that were open before the filter, which is
	// the opposite of what a reset wants.
	if (typeof userHistory !== "undefined" && userHistory.length > 0) sHistory = [...userHistory]
	if (typeof userHistory !== "undefined") userHistory = []
	if (typeof userOpenCiphers !== "undefined") userOpenCiphers = []
	if (typeof histDisplayOrder !== "undefined") histDisplayOrder = null // also drops hiddenCiphers
	$("#highlightBox").val("")
	$("#clearFilterButton").html("")

	// 3. rebuild the menus so every tickbox shows its reset value, then put the
	// cypher selection back to the built-in base four
	document.getElementById("calcOptionsPanel").innerHTML = ""
	initCalc(false, true)
	if (typeof enableDefaultCiphers === "function") enableDefaultCiphers()

	updateTables()
	updateInterfaceColor(true)
	if (typeof coderainApplyBackdrop === "function") coderainApplyBackdrop()
	if (typeof toggleCodeRain === "function") toggleCodeRain()

	// let the account sync notice, rather than treating this as unchanged
	if (typeof wsSyncLastHash !== "undefined") wsSyncLastHash = null

	if (!silent && typeof displayCalcNotification === "function") {
		displayCalcNotification("Reset to default — code rain kept", 2400)
	}
	return true
}

// ---- reloading twice ---------------------------------------------------
//
// Detected once, here, because both this reset and the History Table clear act
// on the same gesture and the mark is consumed when it is read. history-sync.js
// reads calcDoubleRefresh rather than testing again.

var CALC_DOUBLE_REFRESH_MS = 5000
var CALC_REFRESH_KEY = "histLastLoad"

function calcDetectDoubleRefresh() {
	var now = Date.now()
	var last = 0
	try { last = Number(window.sessionStorage.getItem(CALC_REFRESH_KEY)) || 0 } catch (e) { return false }

	var quick = (last > 0 && now - last < CALC_DOUBLE_REFRESH_MS)
	// consumed either way, so a third reload starts counting again instead of
	// resetting over and over
	try { window.sessionStorage.setItem(CALC_REFRESH_KEY, quick ? "0" : String(now)) } catch (e) {}
	return quick
}

// only the calculator page has settings to reset
var calcDoubleRefresh = (typeof exportCalcOptions === "function") ? calcDetectDoubleRefresh() : false

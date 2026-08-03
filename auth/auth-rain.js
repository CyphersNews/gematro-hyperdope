// ============== Code rain shim for the auth pages ==================
//
// coderain.js reads a handful of globals that normally come from calc.js and
// init-variables.js. The auth pages have no calculator, and loading the whole
// of calc.js just for a background would build every menu and cipher for
// nothing. This declares only what the rain actually touches.
//
// getCodeRainColor() and coderainCCRUBg() both guard on `typeof cipherList`,
// so with no cipher list present they fall back to the fixed hue below, which
// is exactly what we want here.

// interface colours, matching the calculator's defaults
var interfaceHue = 222
var interfaceSat = 1.0
var interfaceLit = 1.0

// rain colour, a touch brighter than the calculator's so it reads through the
// darker auth backdrop
var coderainHue = 148
var coderainSat = 0.35
var coderainLit = 0.22

var optMatrixCodeRain = true
var optCoderainFollowCipher = false // no ciphers on this page to follow

// engine state that init-variables.js would normally declare
var code_rain
var height_html, canvas, ctx
var w, h, ypos, cols

// Respect the visitor's saved preference if they have one, so the login page
// looks like the calculator they left. Stored by the calculator as JS text.
;(function readSavedRainPrefs() {
	try {
		var raw = window.localStorage.getItem("userCalcSettings")
		if (!raw) return
		var style = raw.match(/coderainStyle\s*=\s*["']([a-z]+)["']/)
		if (style) window.coderainStyleSaved = style[1]
		var on = raw.match(/optMatrixCodeRain\s*=\s*(true|false)/)
		if (on) optMatrixCodeRain = (on[1] === "true")
		var dens = raw.match(/coderainDensity\s*=\s*([\d.]+)/)
		if (dens) window.coderainDensitySaved = parseFloat(dens[1])
		var spd = raw.match(/coderainSpeedMul\s*=\s*([\d.]+)/)
		if (spd) window.coderainSpeedSaved = parseFloat(spd[1])
	} catch (e) { /* private mode or blocked storage, keep the defaults */ }
})()

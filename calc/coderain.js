// ================ Code rain (HTML5 canvas) =================
//
// Two styles share this canvas:
//   "new"   - multi-script glyph rain, subtle, colour follows the active cipher
//   "retro" - the original upstream matrix rain, kept verbatim in behaviour
// optMatrixCodeRain is the on/off switch (themes still set it); coderainStyle
// picks which of the two runs. The nav button cycles Off -> On -> Retro.

var coderainStyle = "new" // "new" or "retro"

// ---- glyph pool (new style) -------------------------------------------

// Each entry is [firstCodePoint, lastCodePoint, representativeCodePoint, weight].
// Only scripts the calculator actually has ciphers for are listed, so the rain
// reads as the same alphabet soup the app works in. Weight is how many times
// the range is repeated in the pool: Latin dominates, everything else accents.
//
// The representative is rendered once at startup; if the browser has no font
// for it the whole range is dropped rather than drawn as empty boxes.
var coderainRanges = [
	[0x0061, 0x007A, 0x0061, 14], // latin lowercase
	[0x0041, 0x005A, 0x0041, 7],  // latin uppercase
	[0x0030, 0x0039, 0x0030, 6],  // digits
	[0x30A1, 0x30FA, 0x30A2, 1],  // katakana, the classic matrix accent
	[0x05D0, 0x05EA, 0x05D0, 1],  // hebrew
	[0x0391, 0x03A9, 0x03A3, 1],  // greek uppercase
	[0x03B1, 0x03C9, 0x03BB, 1],  // greek lowercase
	[0x0410, 0x044F, 0x0416, 1]   // cyrillic
]

var coderainGlyphs = [] // flat array of renderable characters
var coderainFontStack = "'Roboto Mono', 'Segoe UI', system-ui, sans-serif"

// CCRU style: the numogram is decimal, so digits dominate, cut with hex letters
// and block/technical glyphs for a harder machine look.
var coderainCCRUPool = [
	["0123456789", 8],
	["ABCDEF", 2],
	["▓▒░│┃╱╲╳", 2],
	["⌁⌇⧉◤◥◣◢", 1],
	["アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン", 1]
]
var coderainCCRUGlyphs = []

function buildCCRUGlyphs() {
	if (coderainCCRUGlyphs.length) return
	for (var i = 0; i < coderainCCRUPool.length; i++) {
		var set = coderainCCRUPool[i][0], weight = coderainCCRUPool[i][1]
		for (var r = 0; r < weight; r++) {
			for (var c = 0; c < set.length; c++) coderainCCRUGlyphs.push(set.charAt(c))
		}
	}
}

// Renders a character offscreen and returns a bitmap signature of the result.
// Comparing signatures is the only reliable way to spot a missing glyph:
// measuring advance width does not work, because in a monospace face the
// tofu box is exactly as wide as every real character.
function coderainGlyphSignature(probe, ch) {
	probe.clearRect(0, 0, 22, 22)
	if (ch !== null) probe.fillText(ch, 2, 2)
	var px = probe.getImageData(0, 0, 22, 22).data
	var sig = ""
	for (var i = 3; i < px.length; i += 4) sig += (px[i] > 40) ? "1" : "0" // alpha channel only
	return sig
}

function buildCodeRainGlyphs() {
	if (coderainGlyphs.length) return // already built

	var cvs = document.createElement("canvas")
	cvs.width = 22; cvs.height = 22
	var probe = cvs.getContext("2d", { willReadFrequently: true })
	probe.font = "16px " + coderainFontStack
	probe.textBaseline = "top"
	probe.fillStyle = "#fff"

	var blankSig = coderainGlyphSignature(probe, null)          // nothing drawn
	var tofuSig = coderainGlyphSignature(probe, "￿")       // guaranteed-missing glyph

	for (var r = 0; r < coderainRanges.length; r++) {
		var range = coderainRanges[r]
		var sig = coderainGlyphSignature(probe, String.fromCodePoint(range[2]))
		// drop the script if its representative renders as a tofu box or as nothing
		if (sig === tofuSig || sig === blankSig) continue
		// repeat by weight so the random pick is biased toward Latin
		for (var rep = 0; rep < range[3]; rep++) {
			for (var c = range[0]; c <= range[1]; c++) coderainGlyphs.push(String.fromCodePoint(c))
		}
	}

	if (!coderainGlyphs.length) { // paranoid fallback, latin only
		for (var i = 0x30; i <= 0x39; i++) coderainGlyphs.push(String.fromCharCode(i))
		for (var j = 0x61; j <= 0x7A; j++) coderainGlyphs.push(String.fromCharCode(j))
	}
}

// ---- colour -----------------------------------------------------------

// When optCoderainFollowCipher is on, the rain borrows the hue and saturation
// of whichever cipher is currently selected, but keeps the lightness pinned to
// coderainLit so a bright cipher can never turn the background harsh.
function getCodeRainColor() {
	var hue = coderainHue
	var sat = coderainSat * 100
	var lit = coderainLit * 100

	if (typeof optCoderainFollowCipher !== "undefined" && optCoderainFollowCipher) {
		if (typeof cipherList !== "undefined" && typeof breakCipher !== "undefined") {
			for (var i = 0; i < cipherList.length; i++) {
				if (cipherList[i].cipherName == breakCipher) {
					hue = cipherList[i].H
					sat = cipherList[i].S * 0.75 // pull back so it reads as texture, not signal
					break
				}
			}
		}
	}
	return { h: hue, s: sat, l: lit }
}

// ---- engine -----------------------------------------------------------

var coderainDrops = []   // new style: one drop per column: {row, speed}
var coderainCellW = 22   // column spacing, px
var coderainCellH = 24   // row height, px
var coderainFadeAlpha = 0.17 // lower = longer trails
var coderainSpeedMin = 0.45  // rows advanced per frame
var coderainSpeedVar = 0.45  // random extra on top of the minimum
var coderainDPR = 1
var coderainReducedMotion = false

// retro ran at 50ms; the new style needs 30fps or it reads as stutter, and
// CCRU is deliberately the twitchiest of the three
function coderainFrameInterval() {
	if (coderainStyle === "retro") return 50
	if (coderainStyle === "ccru") return 28
	return 33
}

function coderainSpeed() {
	return (coderainSpeedMin + Math.random() * coderainSpeedVar) * coderainSpeedMul
}

function initCodeRain() {

	canvas = document.getElementById("canv")
	ctx = canvas.getContext("2d")

	coderainReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

	if (navigator.userAgent.toLowerCase().indexOf('firefox') > -1) $('#canv').css({'filter':'blur(1px)'}) // blur effect for Firefox

	height_html = $(window).height()

	if (coderainStyle === "retro") {
		// original sizing: backing store in CSS pixels, no DPR scaling
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		w = canvas.width = document.body.offsetWidth
		h = canvas.height = height_html

		ctx.fillStyle = "hsl("+interfaceHue+","+(22*interfaceSat)+"%,"+(16*interfaceLit)+"%)" // CSS var(--body-bg-accent)
		ctx.fillRect(0, 0, w, h)

		cols = Math.floor(w / 14) + 1 // px
		ypos = Array(cols).fill(0)
		return
	}

	if (coderainStyle === "ccru") {
		buildCCRUGlyphs()
		coderainCellW = 12  // dense grid, roughly twice the columns of the standard style
		coderainCellH = 14
		coderainFadeAlpha = 0.16
		coderainSpeedMin = 0.70
		coderainSpeedVar = 0.85
	} else {
		buildCodeRainGlyphs()
		// tighter grid and longer trails than before, so the standard style
		// reads as a full field of green rather than scattered drops
		coderainCellW = 15
		coderainCellH = 17
		coderainFadeAlpha = 0.12
		coderainSpeedMin = 0.45
		coderainSpeedVar = 0.45
	}

	// size the backing store to the device pixel ratio so glyphs stay crisp,
	// then work in CSS pixels for everything else
	// #canv is fixed at 100%/100%, so measure the viewport rather than the body
	coderainDPR = window.devicePixelRatio || 1
	w = $(window).width()
	h = height_html

	canvas.width = Math.floor(w * coderainDPR)
	canvas.height = Math.floor(h * coderainDPR)
	ctx.setTransform(coderainDPR, 0, 0, coderainDPR, 0, 0)

	// CCRU sits on its own green wash; the standard style fades from the
	// interface background so it disappears into the page
	ctx.fillStyle = (coderainStyle === "ccru")
		? coderainCCRUBg(1)
		: "hsl("+interfaceHue+","+(22*interfaceSat)+"%,"+(16*interfaceLit)+"%)"
	ctx.fillRect(0, 0, w, h)

	// density squeezes or widens the column grid; fewer, wider columns reads as
	// lighter rain, more, narrower columns as heavier
	var effCellW = Math.max(6, Math.round(coderainCellW / coderainDensity))
	cols = Math.floor(w / effCellW) + 1
	coderainCellW = effCellW

	// CCRU keeps nearly every column live at once, the standard style leaves gaps
	// density also shortens the idle gap, so heavier means more columns active
	var stagger = ((coderainStyle === "ccru") ? 0.3 : 0.45) / coderainDensity

	coderainDrops = []
	var maxRow = h / coderainCellH
	for (var i = 0; i < cols; i++) {
		coderainDrops.push({
			row: -Math.random() * maxRow * stagger,
			speed: coderainSpeed()
		})
	}
}

// frame dispatcher, kept as matrix() because other modules clearInterval on it
function matrix() {
	if (!ctx) return
	if (coderainStyle === "retro") matrixRetro()
	else if (coderainStyle === "ccru") matrixCCRU()
	else matrixNew()
}

// CCRU has its own committed palette: a green wash behind neon glyphs. It
// ignores the follow-the-cipher colour on purpose, that option shapes the
// standard style. Denser grid, faster fall, glow, and a layer of static.
var coderainCCRUHue = 138 // fallback only, used before the cipher list exists

// The wash sits behind the glyphs and takes the same hue, so switching cipher
// re-tints the whole field rather than just the characters.
function coderainCCRUBg(alpha) {
	var hue = coderainCCRUHue
	if (typeof cipherList !== "undefined" && typeof getCodeRainColor === "function") {
		hue = getCodeRainColor().h
	}
	return "hsla(" + hue + ", 55%, 7%, " + alpha + ")"
}

function matrixCCRU() {

	var maxRow = h / coderainCellH

	ctx.globalCompositeOperation = "source-over"
	ctx.shadowBlur = 0
	ctx.shadowColor = "hsla(0,0%,0%,0)"
	ctx.fillStyle = coderainCCRUBg(coderainFadeAlpha)
	ctx.fillRect(0, 0, w, h)

	// CCRU tracks the selected cipher like the standard style does, but keeps
	// its own neon treatment: saturation and lightness are forced high rather
	// than taken from the cipher, so it always reads as neon rather than muted.
	var H = getCodeRainColor().h
	var trailCol = "hsl(" + H + ", 90%, 34%)"
	var headCol  = "hsl(" + (H + 12) + ", 100%, 72%)"
	var staticCol = "hsla(" + (H + 20) + ", 100%, 78%, 0.55)"

	ctx.font = "600 12px " + coderainFontStack
	ctx.textBaseline = "top"

	var aLen = coderainCCRUGlyphs.length
	var slow = coderainReducedMotion ? 0.25 : 1

	for (var i = 0; i < coderainDrops.length; i++) {
		var drop = coderainDrops[i]
		var prevRow = Math.floor(drop.row)
		drop.row += drop.speed * slow
		var newRow = Math.floor(drop.row)

		if (newRow === prevRow) continue
		if (newRow < 0) continue

		var x = i * coderainCellW
		var y = newRow * coderainCellH

		if (prevRow >= 0) {
			ctx.shadowBlur = 0
			ctx.fillStyle = trailCol
			ctx.fillText(coderainCCRUGlyphs[rndInt(0, aLen - 1)], x, prevRow * coderainCellH)
		}

		// neon head: bright core with a glow behind it
		ctx.shadowColor = "hsla(" + H + ", 100%, 55%, 0.9)"
		ctx.shadowBlur = 8
		ctx.fillStyle = headCol
		ctx.fillText(coderainCCRUGlyphs[rndInt(0, aLen - 1)], x, y)
		ctx.shadowBlur = 0

		if (newRow > maxRow) {
			drop.row = -Math.random() * maxRow * 0.3
			drop.speed = coderainSpeed()
		}
	}

	// static: scattered neon glyphs that flare and decay with the wash, so the
	// field never sits still between the falling columns
	var staticCount = Math.max(12, Math.floor(cols * 0.5))
	ctx.shadowColor = "hsla(" + H + ", 100%, 60%, 0.8)"
	ctx.shadowBlur = 6
	ctx.fillStyle = staticCol
	for (var s = 0; s < staticCount; s++) {
		var sx = Math.floor(Math.random() * cols) * coderainCellW
		var sy = Math.floor(Math.random() * maxRow) * coderainCellH
		ctx.fillText(coderainCCRUGlyphs[rndInt(0, aLen - 1)], sx, sy)
	}
	ctx.shadowBlur = 0
}

function matrixNew() {

	var maxRow = h / coderainCellH

	// fade the previous frame toward the interface background colour rather
	// than toward black, so light themes fade correctly too
	ctx.globalCompositeOperation = "source-over"
	ctx.shadowBlur = 0
	ctx.shadowColor = "hsla(0,0%,0%,0)"
	ctx.fillStyle = "hsla("+interfaceHue+","+(22*interfaceSat)+"%,"+(16*interfaceLit)+"%,"+coderainFadeAlpha+")"
	ctx.fillRect(0, 0, w, h)

	var col = getCodeRainColor()
	var trailCol = "hsl("+col.h+","+col.s+"%,"+(col.l * 0.8)+"%)"
	var headCol = "hsl("+col.h+","+Math.min(col.s + 8, 100)+"%,"+Math.min(col.l * 1.75, 52)+"%)"

	ctx.font = "500 15px " + coderainFontStack
	ctx.textBaseline = "top"

	var aLen = coderainGlyphs.length
	var slow = coderainReducedMotion ? 0.25 : 1

	for (var i = 0; i < coderainDrops.length; i++) {
		var drop = coderainDrops[i]
		var prevRow = Math.floor(drop.row)
		drop.row += drop.speed * slow
		var newRow = Math.floor(drop.row)

		if (newRow === prevRow) continue // hasn't crossed into a new cell yet
		if (newRow < 0) continue         // still above the top edge

		var x = i * coderainCellW
		var y = newRow * coderainCellH

		// dim the glyph the head just left behind, so the brightest point is
		// always the leading edge
		if (prevRow >= 0) {
			ctx.fillStyle = trailCol
			ctx.fillText(coderainGlyphs[rndInt(0, aLen - 1)], x, prevRow * coderainCellH)
		}

		ctx.fillStyle = headCol
		ctx.fillText(coderainGlyphs[rndInt(0, aLen - 1)], x, y)

		// recycle the column once it runs off the bottom, after an idle gap so
		// the columns keep drifting out of sync with each other
		if (newRow > maxRow) {
			drop.row = -Math.random() * maxRow * 1.05
			drop.speed = coderainSpeed()
		}
	}
}

// The original rain, unchanged: uniform column speed, matrix-font glyphs,
// black fade and a glow shadow.
function matrixRetro() {

	// draw a semitransparent black rectangle on top of previous drawing
	ctx.fillStyle = "#00000010"
	if(navigator.userAgent.toLowerCase().indexOf('firefox') == -1) { // if not Firefox
		ctx.shadowColor = "hsla(0,0%,0%,0.0)" // reset blurred shadows for old characters
		ctx.shadowBlur = 0 // reset blurred shadows
	}
	ctx.fillRect(0, 0, w, h)

	// set color and font in the drawing context
	ctx.fillStyle = "hsl("+coderainHue+","+(coderainSat*100)+"%,"+(coderainLit*100)+"%)"
	ctx.font = "bold 18pt matrix-font"
	ctx.textBaseline = "alphabetic"
	if(navigator.userAgent.toLowerCase().indexOf('firefox') == -1) { // if not Firefox
		ctx.shadowColor = "hsla("+coderainHue+",100%,50%,0.4)"
		ctx.shadowBlur = 4
	}

	var matrixChars = [97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,
		48,49,50,51,52,53,54,55,56,57,36,43,45,42,47,61,37,34,39,35,38,95,40,41,44,46,59,58,63,33,92,124,123,125,60,62,91,93,94,126]
	var aLen = matrixChars.length // glyphs from matrix font

	// for each column put a random character at the end
	ypos.forEach((y, ind) => {

		// choose a random character from array
		text = String.fromCharCode(matrixChars[rndInt(0,aLen-1)])

		// x coordinate of the column, y coordinate is already given
		x = ind * 14 // px
		// render the character at (x, y)
		ctx.fillText(text, x, y)

		// randomly reset the end of the column if it's at least 100px high
		if (y > 100 + Math.random() * 10000) ypos[ind] = 0
		// otherwise just move the y coordinate for the column 20px down
		else ypos[ind] = y + 21 // px
	});
}

function rndInt(min, max) { // inclusive
	return Math.floor(Math.random()*(max-min+1)+min)
}

function toggleCodeRain() {
	if (optMatrixCodeRain) {
		clearInterval(code_rain) // reset previous instance
		document.getElementById("canv").style.display = "none"
		initCodeRain() // recalculate canvas size
		code_rain = setInterval(matrix, coderainFrameInterval())
		document.getElementById("canv").style.display = ""
	} else {
		clearInterval(code_rain)
		document.getElementById("canv").style.display = "none"
	}
	updateCodeRainToggleBtn()
	coderainApplyBackdrop() // rain off still shows the picked colour behind the page
	return
}

// "Background" is too long for the nav row, so the falling-rain glyph carries
// the meaning and only the state is spelled out
var coderainGlyphIcon = "⇊"

function coderainStateLabel() {
	if (!optMatrixCodeRain) return coderainGlyphIcon + " Off"
	if (coderainStyle === "retro") return coderainGlyphIcon + " Retro"
	if (coderainStyle === "ccru") return coderainGlyphIcon + " CCRU"
	return coderainGlyphIcon + " On"
}

// keeps the on-page toggle button and the Options checkbox showing the same state
function updateCodeRainToggleBtn() {
	var btn = document.getElementById("bgToggleBtn")
	if (btn !== null) {
		btn.textContent = coderainStateLabel()
		btn.title = "Background code rain: " + (optMatrixCodeRain ? coderainStyle : "off") + " (click to cycle Off, On, Retro, CCRU)"
		btn.classList.remove("bgToggleOff", "bgToggleRetro", "bgToggleCCRU")
		if (!optMatrixCodeRain) btn.classList.add("bgToggleOff")
		else if (coderainStyle === "retro") btn.classList.add("bgToggleRetro")
		else if (coderainStyle === "ccru") btn.classList.add("bgToggleCCRU")
	}
	var chk = document.getElementById("chkbox_MCR")
	if (chk !== null) chk.checked = optMatrixCodeRain
}

// ---- intensity controls -----------------------------------------------
//
// Density and speed multipliers applied on top of whichever style is running,
// so the hover panel tunes all three styles rather than needing its own set of
// numbers per style. 1.0 is the tuned default for each.

var coderainDensity = 1.0   // 0.2 sparse .. 2.0 heavy
var coderainSpeedMul = 1.0  // 0.3 slow .. 2.5 fast

function coderainSetDensity(v) {
	coderainDensity = Math.max(0.2, Math.min(2.0, Number(v) || 1))
	var lbl = document.getElementById("rainDensityVal")
	if (lbl !== null) lbl.textContent = coderainDensity.toFixed(2) + "x"
	if (optMatrixCodeRain) toggleCodeRain() // re-init, column count depends on this
}

function coderainSetSpeed(v) {
	coderainSpeedMul = Math.max(0.3, Math.min(2.5, Number(v) || 1))
	var lbl = document.getElementById("rainSpeedVal")
	if (lbl !== null) lbl.textContent = coderainSpeedMul.toFixed(2) + "x"
	// applied per frame, no re-init needed
}

function coderainResetIntensity() {
	var d = document.getElementById("rainDensitySlider")
	var sp = document.getElementById("rainSpeedSlider")
	var hu = document.getElementById("rainHueSlider")
	if (d !== null) d.value = 1
	if (sp !== null) sp.value = 1
	coderainSetSpeed(1)
	coderainHue = coderainHueDefault
	coderainSat = coderainSatDefault
	coderainColorPicked = false // back to the stock page background
	if (hu !== null) hu.value = coderainHue
	coderainSyncColorInputs()
	coderainApplyBackdrop()
	coderainSetFollow(true) // back to tracking the selected cipher
	var fc = document.getElementById("rainFollowChk")
	if (fc !== null) fc.checked = true
	coderainSetDensity(1) // last, it re-inits
}

// Manual rain hue. Setting it turns off follow-the-cipher, since the two
// would otherwise fight over the same colour on the next repaint.
function coderainSetHue(deg) {
	coderainHue = Math.max(0, Math.min(359, Number(deg) || 0))
	coderainColorPicked = true
	coderainDropFollow()
	coderainSyncColorInputs()
	coderainApplyBackdrop()
}

// The swatch is a real colour input, like the per-cipher swatches in Color
// Controls, so saturation can be chosen too and not just hue. Lightness is
// read but deliberately not applied: the rain is drawn at coderainLit so a
// near-white pick cannot blow out the page.
function coderainSetColorFromPicker(hex) {
	var c = hexToHsl(hex)
	coderainHue = c.H
	coderainSat = Math.max(0, Math.min(100, c.S)) / 100
	coderainColorPicked = true
	coderainDropFollow()
	coderainSyncColorInputs()
	coderainApplyBackdrop()
}

// Picking a colour by hand and following the selected cipher would fight over
// the same value on the next repaint, so choosing one drops the other.
function coderainDropFollow() {
	if (typeof optCoderainFollowCipher !== "undefined" && optCoderainFollowCipher) {
		optCoderainFollowCipher = false
		var chk = document.getElementById("chkbox_CFC")
		if (chk !== null) chk.checked = false
	}
	var fc = document.getElementById("rainFollowChk")
	if (fc !== null) fc.checked = false
}

// keep the hue slider and the swatch showing the same colour
function coderainSyncColorInputs() {
	var hu = document.getElementById("rainHueSlider")
	if (hu !== null) hu.value = coderainHue
	var sw = document.getElementById("rainColorPicker")
	if (sw !== null) sw.value = hslToHex(coderainHue, coderainSat * 100, 55)
}

// The page background picks up the chosen rain colour, so turning the rain off
// or running it thin still leaves the scheme the user asked for rather than
// snapping back to the stock blue-grey. Kept very dark and desaturated - it is
// a tint behind the content, not a wash over it.
//
// Only applies once a colour has actually been picked, so the default look is
// untouched on a first visit.
function coderainApplyBackdrop() {
	var root = document.documentElement
	if (!coderainColorPicked) {
		root.style.removeProperty("--rain-backdrop")
		return
	}
	var sat = Math.min(30, Math.round(coderainSat * 100))
	root.style.setProperty("--rain-backdrop", "hsl(" + coderainHue + " " + sat + "% 11%)")
}

function coderainSetFollow(on) {
	optCoderainFollowCipher = !!on
	var chk = document.getElementById("chkbox_CFC")
	if (chk !== null) chk.checked = optCoderainFollowCipher
	// following a cipher means the rain colour is no longer the user's pick, so
	// the backdrop goes back to the stock page background
	if (optCoderainFollowCipher) {
		coderainColorPicked = false
		coderainApplyBackdrop()
	}
}

// The panel that drops down when hovering the nav toggle. Deliberately terse:
// three sliders, a follow toggle and a reset, no prose.
function coderainIntensityPanel() {
	var follow = (typeof optCoderainFollowCipher !== "undefined" && optCoderainFollowCipher)
	var o = '<div class="rainTunePanel">'

	o += '<div class="rainTuneRow"><span class="rainTuneLabel">Density</span>'
	o += '<input type="range" id="rainDensitySlider" class="rainTuneSlider" min="0.2" max="2" step="0.05" value="'+coderainDensity+'" oninput="coderainSetDensity(this.value)">'
	o += '<span class="rainTuneVal" id="rainDensityVal">'+coderainDensity.toFixed(2)+'x</span></div>'

	o += '<div class="rainTuneRow"><span class="rainTuneLabel">Speed</span>'
	o += '<input type="range" id="rainSpeedSlider" class="rainTuneSlider" min="0.3" max="2.5" step="0.05" value="'+coderainSpeedMul+'" oninput="coderainSetSpeed(this.value)">'
	o += '<span class="rainTuneVal" id="rainSpeedVal">'+coderainSpeedMul.toFixed(2)+'x</span></div>'

	// hue slider for a quick sweep, plus a real colour input like the per-cipher
	// swatches in Color Controls for picking an exact shade
	o += '<div class="rainTuneRow"><span class="rainTuneLabel">Colour</span>'
	o += '<input type="range" id="rainHueSlider" class="rainTuneSlider rainHueSlider" min="0" max="359" step="1" value="'+coderainHue+'" oninput="coderainSetHue(this.value)">'
	o += '<span class="rainTuneVal"><input type="color" id="rainColorPicker" class="rainColorPicker" value="'+hslToHex(coderainHue, coderainSat * 100, 55)+'" title="Pick a rain colour" oninput="coderainSetColorFromPicker(this.value)"></span></div>'

	o += '<div class="rainTuneRow rainTuneFoot">'
	o += '<label class="rainFollowLabel"><input type="checkbox" id="rainFollowChk"'+(follow ? " checked" : "")+' onchange="coderainSetFollow(this.checked)"> Follow cipher</label>'
	o += '<input class="intBtn3 rainTuneReset" type="button" value="Reset" onclick="coderainResetIntensity()">'
	o += '</div>'

	o += '</div>'
	return o
}

// nav button: Off -> On (new) -> Retro -> CCRU -> Off
function toggleCodeRainBtn() {
	if (!optMatrixCodeRain) { optMatrixCodeRain = true; coderainStyle = "new" }
	else if (coderainStyle === "new") { coderainStyle = "retro" }
	else if (coderainStyle === "retro") { coderainStyle = "ccru" }
	else { optMatrixCodeRain = false; coderainStyle = "new" }
	toggleCodeRain()
}

toggleCodeRain()

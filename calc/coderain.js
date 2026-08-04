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

		// starts clear: the fade erases alpha, so #canv's CSS background is what
		// shows through rather than a painted copy of it
		ctx.clearRect(0, 0, w, h)

		cols = Math.floor(w / 14) + 1 // px
		ypos = Array(cols).fill(0)
		yglf = []; for (var q = 0; q < cols; q++) yglf.push([]) // per-column trail glyphs
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

	// CCRU sits on its own green wash. The standard style starts clear instead
	// of filled: it fades by erasing alpha, so the page background showing
	// through #canv is the background, and priming the canvas opaque would just
	// leave a full-screen layer to erode away over the first few seconds.
	if (coderainStyle === "ccru") {
		ctx.fillStyle = coderainCCRUBg(1)
		ctx.fillRect(0, 0, w, h)
	} else {
		ctx.clearRect(0, 0, w, h)
	}

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
		var sp = coderainSpeed()
		coderainDrops.push({
			row: -Math.random() * maxRow * stagger,
			speed: sp,
			trail: coderainTrailRows(sp),
			glyphs: [] // newest first, one per cell the head has entered
		})
	}
}

// Visible trail length in rows: how far behind the head a glyph has dimmed to
// nothing. A cell k rows back was drawn k/speed frames ago, and each frame
// costs it a factor of (1 - fadeAlpha), so it is invisible once that product
// falls below CODERAIN_MIN_ALPHA. Capped so a slow drop cannot drag a trail
// long enough to matter for the per-frame cost.
var CODERAIN_MIN_ALPHA = 0.004 // ~1/255, the point a glyph stops registering

function coderainTrailRows(speed) {
	var frames = Math.log(CODERAIN_MIN_ALPHA) / Math.log(1 - coderainFadeAlpha)
	return Math.max(4, Math.min(42, Math.round(frames * speed)))
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

	// Cleared and redrawn every frame rather than faded in place.
	//
	// Fading in place cannot finish. The fade scales alpha by a constant, and
	// integer rounding gives that a fixed point: round(4 * 0.88) is 4, so any
	// cell that reaches an alpha of 4 keeps it for good. It is the full glyph
	// colour at that alpha, and it only ever lands on the glyph grid, so it
	// accumulates into the blocky green film that no amount of further fading
	// washes out. No multiplicative fade can reach zero, and a trail longer
	// than the screen leaves nothing for a trailing sweep to clean up either.
	//
	// So the trail is state, not residue: each column remembers the glyphs it
	// has dropped and repaints them at a computed alpha. Costs a few thousand
	// fillText calls a frame, measured at around 3ms against a 33ms budget, and
	// the background behind the rain is exactly the page background.
	ctx.clearRect(0, 0, w, h)
	ctx.globalCompositeOperation = "source-over"
	ctx.shadowBlur = 0
	ctx.shadowColor = "hsla(0,0%,0%,0)"

	var col = getCodeRainColor()
	var trailCol = "hsl("+col.h+","+col.s+"%,"+(col.l * 0.8)+"%)"
	var headCol = "hsl("+col.h+","+Math.min(col.s + 8, 100)+"%,"+Math.min(col.l * 1.75, 52)+"%)"

	ctx.font = "500 15px " + coderainFontStack
	ctx.textBaseline = "top"

	var aLen = coderainGlyphs.length
	var slow = coderainReducedMotion ? 0.25 : 1
	var decay = 1 - coderainFadeAlpha

	for (var i = 0; i < coderainDrops.length; i++) {
		var drop = coderainDrops[i]
		var prevRow = Math.floor(drop.row)
		drop.row += drop.speed * slow
		var newRow = Math.floor(drop.row)

		// a glyph is chosen once, when the head enters a cell, and kept - the
		// trail should fade, not shimmer
		for (var s = prevRow; s < newRow; s++) {
			drop.glyphs.unshift(coderainGlyphs[rndInt(0, aLen - 1)])
			if (drop.glyphs.length > drop.trail) drop.glyphs.pop()
		}

		var x = i * coderainCellW
		for (var k = 0; k < drop.glyphs.length; k++) {
			var row = newRow - k
			if (row < 0) break        // the rest of the trail is above the top
			if (row > maxRow) continue // head has run past the bottom edge

			// k rows back is k/speed frames old, so it has taken that many
			// passes of the fade - the same curve the in-place fade produced
			var a = Math.pow(decay, k / drop.speed)
			if (a < CODERAIN_MIN_ALPHA) break
			ctx.globalAlpha = a
			ctx.fillStyle = (k === 0) ? headCol : trailCol
			ctx.fillText(drop.glyphs[k], x, row * coderainCellH)
		}
		ctx.globalAlpha = 1

		// recycle once the whole trail has left the bottom, after an idle gap
		// so the columns keep drifting out of sync with each other
		if (newRow - drop.trail > maxRow) {
			drop.row = -Math.random() * maxRow * 1.05
			drop.speed = coderainSpeed()
			drop.trail = coderainTrailRows(drop.speed)
			drop.glyphs = []
		}
	}
	ctx.globalAlpha = 1
}

// The original rain: uniform column speed, matrix-font glyphs and a glow
// shadow. The fade erases alpha rather than painting black over the top - see
// matrixNew() for why - which keeps the same trail length without leaving the
// blocky residue the old "#00000010" wash baked in.
function matrixRetro() {

	// Same story as matrixNew(): fading in place leaves a permanent sliver of
	// colour in every cell a glyph ever touched, so the trail is kept as state
	// and the canvas is cleared and repainted each frame.
	ctx.clearRect(0, 0, w, h)
	ctx.globalCompositeOperation = "source-over"

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

	var trail = coderainRetroTrail()
	var decay = 1 - 0.063 // the original fade, now applied per glyph

	// for each column put a random character at the end
	ypos.forEach((y, ind) => {

		// a glyph is picked once, when the column reaches that step, and kept
		var colGlyphs = yglf[ind]
		colGlyphs.unshift(String.fromCharCode(matrixChars[rndInt(0,aLen-1)]))
		if (colGlyphs.length > trail) colGlyphs.pop()

		var x = ind * 14 // px
		for (var k = 0; k < colGlyphs.length; k++) {
			var gy = y - k * 21
			if (gy < 0) break
			if (gy > h + 21) continue
			var a = Math.pow(decay, k)
			if (a < CODERAIN_MIN_ALPHA) break
			ctx.globalAlpha = a
			ctx.fillText(colGlyphs[k], x, gy)
		}
		ctx.globalAlpha = 1

		// randomly reset the end of the column if it's at least 100px high
		if (y > 100 + Math.random() * 10000) { ypos[ind] = 0; yglf[ind] = [] }
		// otherwise just move the y coordinate for the column 20px down
		else ypos[ind] = y + 21 // px
	});
	ctx.globalAlpha = 1
}

// Retro trail length in 21px steps, bounded so a very long trail cannot make
// the per-frame cost matter.
function coderainRetroTrail() {
	return Math.max(6, Math.min(50, Math.ceil(Math.log(CODERAIN_MIN_ALPHA) / Math.log(1 - 0.063))))
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
	// With the rain running, the colour belongs to the rain: tinting the page
	// as well made picking a colour feel like it was recolouring the whole
	// site. With the rain off there is nothing else for the colour to apply
	// to, so it becomes the background - which is the only way to change the
	// page colour without turning the rain on.
	if (!coderainColorPicked || optMatrixCodeRain) {
		root.style.removeProperty("--rain-backdrop")
		return
	}
	var sat = Math.min(30, Math.round(coderainSat * 100))
	root.style.setProperty("--rain-backdrop", "hsl(" + coderainHue + " " + sat + "% 11%)")
}

// Called when a cypher is selected: the rain goes back to following it.
//
// Picking a colour by hand turns following off, which is right until the next
// cypher is chosen - at that point the manual colour is stale and the rain
// should track the new selection again. Only the standard style is switched
// back; Retro and CCRU are colour schemes in their own right.
function coderainFollowSelectedCipher() {
	if (coderainStyle !== "new") return
	if (typeof optCoderainFollowCipher !== "undefined" && optCoderainFollowCipher) return // already following
	coderainSetFollow(true)
	var fc = document.getElementById("rainFollowChk")
	if (fc !== null) fc.checked = true
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

// ---- keeping the tuning panel open ------------------------------------
//
// CSS :hover alone is not enough here. The toggle is a narrow button at the
// end of the nav row and the panel hangs 250px to its left, so the natural
// move towards a slider cuts the corner, leaves both boxes for a moment and
// the panel vanishes mid-reach.
//
// A short grace period on the way out fixes that: re-entering cancels the
// close. The colour swatch needs more than a grace period, though - opening
// the OS colour dialog takes the pointer out of the window entirely, so the
// panel is pinned while that input has focus and released when it does not.

var rainTuneCloseTimer = null
var rainTunePinned = false

function rainTuneOpen() {
	clearTimeout(rainTuneCloseTimer)
	var dd = document.querySelector(".rainTuneDropdown")
	if (dd !== null) dd.classList.add("rainTuneStuck")
}

function rainTuneClose(delay) {
	clearTimeout(rainTuneCloseTimer)
	rainTuneCloseTimer = setTimeout(function () {
		if (rainTunePinned) return // colour dialog is up, leave it alone
		var dd = document.querySelector(".rainTuneDropdown")
		if (dd !== null) dd.classList.remove("rainTuneStuck")
	}, delay === undefined ? 420 : delay)
}

function rainTunePin(on) {
	rainTunePinned = !!on
	if (rainTunePinned) rainTuneOpen()
	else rainTuneClose(250)
}

$(document).ready(function () {
	$("body").on("mouseenter", ".rainTuneDropdown", function () { rainTuneOpen() })
	$("body").on("mouseleave", ".rainTuneDropdown", function () { rainTuneClose() })
	// tap to open on touch devices, where there is no hover at all
	$("body").on("click", "#bgToggleBtn", function () { rainTuneOpen() })
})

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
	o += '<span class="rainTuneVal"><input type="color" id="rainColorPicker" class="rainColorPicker" value="'+hslToHex(coderainHue, coderainSat * 100, 55)+'" title="Pick a rain colour" oninput="coderainSetColorFromPicker(this.value)" onfocus="rainTunePin(true)" onblur="rainTunePin(false)"></span></div>'

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

// ==================== Birth charts in the Profile ====================
//
// A self-contained chart tab: the birth details, the zodiac to read them in,
// the wheel, the planet list and today's transits, all in one place. It does
// not borrow the Astrology tab's inputs - reaching into another panel's DOM
// meant the tab only worked when that panel happened to be open, which is why
// saving quietly did nothing.
//
// Positions come from astrology.js. Sidereal is the same chart with the
// ayanamsa taken off, so both readings are always available from one set of
// inputs and there is nothing to keep in step.

// ---- zodiac ------------------------------------------------------------

// Lahiri, the standard Indian ayanamsa: 23°51'11" at J2000, drifting about
// 50.28 arcseconds a year.
function astroAyanamsa(d) {
	return 23.8531 + (d / 365.25) * 0.0139659
}

// Shifts a whole chart into the sidereal zodiac. Longitudes move, the
// relationships between them do not, so aspects are left exactly as they were.
function astroToSidereal(chart) {
	var ayan = astroAyanamsa(chart.d)
	var out = {
		d: chart.d, ayanamsa: ayan, phase: chart.phase,
		plutoOutOfRange: chart.plutoOutOfRange,
		bodies: [], aspects: chart.aspects, sidereal: true
	}
	for (var i = 0; i < chart.bodies.length; i++) {
		var b = chart.bodies[i]
		var lon = aRev(b.lon - ayan)
		var s = astroSignOf(lon)
		out.bodies.push({
			key: b.key, name: b.name, glyph: b.glyph, lon: lon,
			sign: s.sign, signIdx: s.idx, deg: s.deg, min: s.min,
			retro: b.retro, speed: b.speed, house: b.house
		})
	}
	if (chart.houses) {
		out.houses = { system: chart.houses.system, cusps: [] }
		for (var h = 0; h < chart.houses.cusps.length; h++) {
			out.houses.cusps.push(aRev(chart.houses.cusps[h] - ayan))
		}
		out.houses.asc = aRev(chart.houses.asc - ayan)
		out.houses.mc = aRev(chart.houses.mc - ayan)
		out.ascSign = astroSignOf(out.houses.asc)
		out.mcSign = astroSignOf(out.houses.mc)
	}
	return out
}

// ---- tab state ---------------------------------------------------------

var pcForm = null      // the details being edited
var pcZodiac = "tropical"
var pcEditingId = null // the saved row being edited, if any

function pcDefaultForm() {
	var now = new Date()
	return {
		name: "",
		y: now.getFullYear() - 30, m: 1, d: 1,
		hh: 12, mm: 0,
		timeKnown: true,
		usePlace: true,
		place: "", lat: 51.5074, lon: -0.1278, tz: 0
	}
}

function pcNum(id, fallback) {
	var e = document.getElementById(id)
	if (e === null) return fallback
	var v = Number(e.value)
	return isFinite(v) ? v : fallback
}

// Reads the form back out of the DOM into pcForm, so a redraw keeps what was
// typed.
function pcCapture() {
	if (pcForm === null) pcForm = pcDefaultForm()
	var nameEl = document.getElementById("pcName")
	if (nameEl !== null) pcForm.name = nameEl.value
	var placeEl = document.getElementById("pcPlace")
	if (placeEl !== null) pcForm.place = placeEl.value
	pcForm.y = pcNum("pcY", pcForm.y); pcForm.m = pcNum("pcM", pcForm.m); pcForm.d = pcNum("pcD", pcForm.d)
	pcForm.hh = pcNum("pcHH", pcForm.hh); pcForm.mm = pcNum("pcMM", pcForm.mm)
	pcForm.lat = pcNum("pcLat", pcForm.lat); pcForm.lon = pcNum("pcLon", pcForm.lon); pcForm.tz = pcNum("pcTZ", pcForm.tz)
	return pcForm
}

function pcSetZodiac(z) { pcCapture(); pcZodiac = z; renderProfileChart() }
function pcToggleTime() { pcCapture(); pcForm.timeKnown = !pcForm.timeKnown; renderProfileChart() }
function pcTogglePlace() { pcCapture(); pcForm.usePlace = !pcForm.usePlace; renderProfileChart() }
function pcRedraw() { pcCapture(); pcDraw() }

// ---- computing ---------------------------------------------------------

// An unknown birth time is treated as noon, which keeps every planet except
// the Moon within a fraction of a degree of the truth. Houses and the
// Ascendant are dropped entirely rather than drawn from a guess.
function pcBuildChart(f, zodiac) {
	var hh = f.timeKnown ? f.hh : 12
	var mm = f.timeKnown ? f.mm : 0
	var ut = hh + mm / 60 - (f.usePlace ? f.tz : 0)
	var loc = (f.usePlace && f.timeKnown) ? { lat: f.lat, lon: f.lon, system: "whole" } : null
	var chart = astroChart(f.y, f.m, f.d, ut, loc)
	return (zodiac === "sidereal") ? astroToSidereal(chart) : chart
}

// Today's sky against the birth chart. Only the slower bodies are worth
// listing: a Moon transit is over in hours, where an outer planet contact is
// the thing people actually want to know about.
var pcTransitBodies = ["jupiter", "saturn", "uranus", "neptune", "pluto", "mars"]

function pcTransits(natal, zodiac) {
	var now = new Date()
	var ut = now.getUTCHours() + now.getUTCMinutes() / 60
	var sky = astroChart(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), ut, null)
	if (zodiac === "sidereal") sky = astroToSidereal(sky)

	var hits = []
	for (var i = 0; i < sky.bodies.length; i++) {
		var t = sky.bodies[i]
		if (pcTransitBodies.indexOf(t.key) === -1) continue
		for (var j = 0; j < natal.bodies.length; j++) {
			var n = natal.bodies[j]
			var sep = Math.abs(aRev(t.lon - n.lon))
			if (sep > 180) sep = 360 - sep
			for (var k = 0; k < astroAspects.length; k++) {
				var asp = astroAspects[k]
				var delta = Math.abs(sep - asp.ang)
				if (delta <= Math.min(asp.orb, 3)) { // tight orbs, or everything hits
					hits.push({ t: t, n: n, aspect: asp, orb: delta })
					break
				}
			}
		}
	}
	hits.sort(function (a, b) { return a.orb - b.orb })
	return { hits: hits.slice(0, 10), when: now }
}

// ---- rendering ---------------------------------------------------------

function renderProfileChart() {
	var tok = profileRenderSeq
	if (pcForm === null) pcForm = pcDefaultForm()

	chartList().then(function (rows) {
		var f = pcForm
		var o = ''

		// Save first: naming and keeping the chart is the reason for this tab,
		// so it should not be at the bottom past everything else.
		o += '<div class="profileSearchRow pcSaveRow">'
		o += '<input type="text" id="pcName" class="profileSearchInput" maxlength="60" placeholder="Whose chart is this?" value="' + authEsc(f.name) + '">'
		o += '<button class="profileMiniBtn pcSaveBtn" onclick="pcSave()">' + (pcEditingId ? "Update chart" : "Save chart") + '</button>'
		if (pcEditingId) o += '<button class="profileMiniBtn" onclick="pcNew()">New</button>'
		o += '</div>'

		o += '<div class="pcZodiacRow">'
		o += '<button class="intBtn3 pcZodBtn' + (pcZodiac === "tropical" ? " pcZodOn" : "") + '" onclick="pcSetZodiac(&quot;tropical&quot;)">&#9711; Tropical</button>'
		o += '<button class="intBtn3 pcZodBtn' + (pcZodiac === "sidereal" ? " pcZodOn" : "") + '" onclick="pcSetZodiac(&quot;sidereal&quot;)">&#9633; Sidereal</button>'
		o += '<span class="profileWhen">Both are worked out from the same details &mdash; switch freely, nothing is re-entered.</span>'
		o += '</div>'

		o += '<div class="pcFields">'
		o += '<div class="pcRow"><label class="pcLab">Born</label>'
		o += pcField("pcY", "Year", f.y, 'pcInY', "")
		o += pcField("pcM", "Month", f.m, '', ' min="1" max="12"')
		o += pcField("pcD", "Day", f.d, '', ' min="1" max="31"')
		o += '</div>'

		o += '<div class="pcRow"><label class="pcLab">Time</label>'
		if (f.timeKnown) {
			o += pcField("pcHH", "Hour", f.hh, '', ' min="0" max="23"')
			o += pcField("pcMM", "Minute", f.mm, '', ' min="0" max="59"')
		} else {
			o += '<span class="profileWhen pcUnknown">Using noon &mdash; no houses or Ascendant</span>'
		}
		o += '<label class="pcChk pcChkBox"><input type="checkbox"' + (f.timeKnown ? '' : ' checked') + ' onchange="pcToggleTime()"> I do not know my birth time</label>'
		o += '</div>'

		o += '<div class="pcRow"><label class="pcLab">Place</label>'
		o += '<label class="pcChk pcChkBox"><input type="checkbox"' + (f.usePlace ? ' checked' : '') + ' onchange="pcTogglePlace()"> Use a birthplace</label>'
		o += '</div>'

		if (f.usePlace) {
			o += '<div class="pcRow"><label class="pcLab"></label>'
			o += '<input type="text" id="pcPlace" class="pcIn pcInPlace" value="' + authEsc(f.place) + '" placeholder="e.g. Brooklyn, New York" oninput="pcRedraw()">'
			o += '<button class="profileMiniBtn" onclick="pcLookupPlace()">Find</button>'
			o += '</div>'
			o += '<div id="pcGeo" class="pcGeo"></div>'
			o += '<div class="pcRow"><label class="pcLab"></label>'
			o += pcField("pcLat", "Latitude", f.lat, '', ' step="0.0001"')
			o += pcField("pcLon", "Longitude", f.lon, '', ' step="0.0001"')
			o += pcField("pcTZ", "UTC offset", f.tz, '', ' step="0.25"')
			o += '</div>'
		}
		o += '</div>'

		// chart on the left, the reading beside it
		o += '<div class="pcSplit">'
		o += '<div class="pcCanvasWrap"><canvas id="pcCanvas"></canvas></div>'
		o += '<div id="pcPlanets" class="pcReading"></div>'
		o += '</div>'
		o += '<div id="pcTransits"></div>'

		if (rows.length) {
			o += '<div class="pcSectionTitle">Saved charts</div>'
			o += '<div class="profileList">'
			rows.forEach(function (r) {
				var nm = authEsc(r.name).replace(/"/g, '&quot;')
				o += '<div class="profileRow">'
				o += '<span class="profileRowPhrase" onclick="pcOpen(&quot;' + r.id + '&quot;)">' + authEsc(r.name) + '</span>'
				o += '<span class="profileRowActions">'
				o += '<span class="profileWhen">' + authEsc(r.birth_date) + (r.time_known === false ? ' (no time)' : '') + '</span>'
				o += '<button class="profileMiniBtn" onclick="pcOpen(&quot;' + r.id + '&quot;)">Open</button>'
				o += '<button class="profileMiniBtn profileMiniDanger" onclick="pcDelete(this,&quot;' + r.id + '&quot;)">&#215;</button>'
				o += '</span></div>'
			})
			o += '</div>'
		}

		profileBody(o, tok)
		// on the next frame, so the row has actually laid out - measuring the
		// space for the chart in the same tick as the markup is written gives
		// the width the panel had a moment ago, not the one it has now
		if (typeof requestAnimationFrame === "function") requestAnimationFrame(pcDraw)
		else pcDraw()
	}).catch(function (err) { profileBody(profileErr(err), tok) })
}

// A number box with its own label underneath, so a bare row of three does not
// leave anyone guessing which one is the month.
function pcField(id, label, value, extraClass, attrs) {
	var o = '<span class="pcFieldWrap">'
	o += '<input type="number" id="' + id + '" class="pcIn ' + (extraClass || '') + '" value="' + value + '"' + (attrs || '') + ' oninput="pcRedraw()">'
	o += '<span class="pcFieldLab">' + label + '</span>'
	o += '</span>'
	return o
}

function pcDraw() {
	var cvs = document.getElementById("pcCanvas")
	if (cvs === null) return
	var f = pcForm
	var chart

	try { chart = pcBuildChart(f, pcZodiac) }
	catch (e) {
		document.getElementById("pcPlanets").innerHTML = '<div class="profileNote profileWarn">Check the date.</div>'
		return
	}

	// The chart takes the width the reading does not use.
	//
	// Measured from the row and the reading rather than from the canvas's own
	// wrapper, which is circular: the wrapper is a flex item sized partly by
	// the canvas inside it, so reading its width before sizing the canvas gives
	// last frame's answer. When that came out too large, "max-width: 100%"
	// clamped the rendered width while the inline height stood, and the chart
	// was drawn into 250x440 - a square squashed to a tall rectangle.
	var wrap = cvs.parentNode
	var split = cvs.closest(".pcSplit")
	var reading = split ? split.querySelector(".pcReading") : null

	// CSS decides the box - width: 100% of the wrapper, capped, aspect-ratio 1 -
	// so this only has to match the backing store to whatever that came out as.
	// Nothing here sets a dimension, so nothing here can make it non-square.
	var size = Math.round(cvs.getBoundingClientRect().width)
	if (!size || size < 60) size = 300

	var dpr = window.devicePixelRatio || 1
	cvs.width = Math.floor(size * dpr); cvs.height = Math.floor(size * dpr)
	var c = cvs.getContext("2d")
	c.setTransform(dpr, 0, 0, dpr, 0, 0)
	c.clearRect(0, 0, size, size)

	if (pcZodiac === "sidereal") pcDrawSquare(c, size, chart)
	else pcDrawWheel(c, size, chart)

	pcListPlanets(chart)
	pcListTransits(chart)
}

function pcInk(v, fallback) { return astroCssVar(v, fallback) }

// Tropical: the familiar round wheel.
function pcDrawWheel(c, size, chart) {
	var cx = size / 2, cy = size / 2
	var rOuter = size * 0.46, rSign = size * 0.38, rInner = size * 0.30
	var line = pcInk("--border-accent", "#556")
	var text = pcInk("--font-white-2", "#ccc")
	var faint = pcInk("--font-white-4", "#889")

	// the Ascendant sits on the left horizon when there is one to place
	var rot = (chart.houses ? chart.houses.asc : 0)

	c.strokeStyle = line; c.lineWidth = 1
	;[rOuter, rSign, rInner].forEach(function (r) {
		c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke()
	})

	c.font = "13px " + (window.coderainFontStack || "sans-serif")
	c.textAlign = "center"; c.textBaseline = "middle"
	for (var i = 0; i < 12; i++) {
		var a0 = astroWheelAngle(i * 30, rot)
		var p0 = astroPolar(cx, cy, rInner, a0), p1 = astroPolar(cx, cy, rOuter, a0)
		c.strokeStyle = line
		c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke()

		var mid = astroPolar(cx, cy, (rSign + rOuter) / 2, astroWheelAngle(i * 30 + 15, rot))
		c.fillStyle = pcSignColor(i)
		c.fillText(astroSigns[i].glyph, mid.x, mid.y)
	}

	// Aspect lines across the middle. The chart has always worked these out;
	// the wheel just never drew them, which is most of what a wheel is for.
	// Colour says which aspect, dash says how wide the orb is.
	if (chart.aspects && chart.aspects.length) {
		for (var ai = 0; ai < chart.aspects.length; ai++) {
			var asp = chart.aspects[ai]
			var pA = astroPolar(cx, cy, rInner, astroWheelAngle(asp.a.lon, rot))
			var pB = astroPolar(cx, cy, rInner, astroWheelAngle(asp.b.lon, rot))
			c.strokeStyle = astroAspectColor(asp.aspect.ang)
			// a tight aspect is drawn solid and a little stronger
			c.globalAlpha = asp.exact ? 0.9 : 0.45
			c.lineWidth = asp.exact ? 1.4 : 1
			c.setLineDash(asp.exact ? [] : [3, 3])
			c.beginPath(); c.moveTo(pA.x, pA.y); c.lineTo(pB.x, pB.y); c.stroke()
		}
		c.setLineDash([])
		c.globalAlpha = 1
		c.lineWidth = 1
	}

	for (var b = 0; b < chart.bodies.length; b++) {
		var body = chart.bodies[b]
		var pa = astroWheelAngle(body.lon, rot)
		var pt = astroPolar(cx, cy, rSign - 14, pa)
		c.fillStyle = pcPlanetColor(body.key)
		c.font = "15px " + (window.coderainFontStack || "sans-serif")
		c.fillText(body.glyph, pt.x, pt.y)
		var tick = astroPolar(cx, cy, rInner, pa), tick2 = astroPolar(cx, cy, rInner + 6, pa)
		c.strokeStyle = pcPlanetColor(body.key)
		c.beginPath(); c.moveTo(tick.x, tick.y); c.lineTo(tick2.x, tick2.y); c.stroke()
	}

	if (chart.houses) {
		c.fillStyle = text
		c.font = "11px " + (window.coderainFontStack || "sans-serif")
		c.textAlign = "left"
		c.fillText("ASC " + astroSigns[chart.ascSign.idx].name, 6, size - 16)
		c.textAlign = "right"
		c.fillText("MC " + astroSigns[chart.mcSign.idx].name, size - 6, size - 16)
	}
}

// Sidereal: the South Indian square, signs in fixed cells and planets written
// into whichever cell they fall in.
var pcSquareCells = [
	[1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3],
	[2, 3], [1, 3], [0, 3], [0, 2], [0, 1], [0, 0]
]

function pcDrawSquare(c, size, chart) {
	var line = pcInk("--border-accent", "#556")
	var faint = pcInk("--font-white-4", "#889")
	var cell = size / 4

	c.strokeStyle = line; c.lineWidth = 1
	c.strokeRect(0.5, 0.5, size - 1, size - 1)

	// group the bodies by sign so each cell can list what it holds
	var inSign = {}
	for (var b = 0; b < chart.bodies.length; b++) {
		var s = chart.bodies[b].signIdx
		if (!inSign[s]) inSign[s] = []
		inSign[s].push(chart.bodies[b])
	}

	c.textAlign = "center"
	for (var i = 0; i < 12; i++) {
		var gx = pcSquareCells[i][0], gy = pcSquareCells[i][1]
		var x = gx * cell, y = gy * cell
		c.strokeStyle = line
		c.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1)

		c.fillStyle = pcSignColor(i)
		c.font = "12px " + (window.coderainFontStack || "sans-serif")
		c.textBaseline = "top"
		c.fillText(astroSigns[i].glyph, x + cell / 2, y + 4)

		var here = inSign[i] || []
		c.font = "13px " + (window.coderainFontStack || "sans-serif")
		for (var k = 0; k < here.length; k++) {
			c.fillStyle = pcPlanetColor(here[k].key)
			c.fillText(here[k].glyph, x + cell / 2, y + 20 + k * 15)
		}

		// the rising sign is the one to start reading from
		if (chart.houses && chart.ascSign.idx === i) {
			c.strokeStyle = pcInk("--checkmark-accent", "#6c6")
			c.lineWidth = 2
			c.strokeRect(x + 2, y + 2, cell - 4, cell - 4)
			c.lineWidth = 1
		}
	}
}

// Short, conventional meanings. Deliberately terse and deliberately generic:
// this is the standard textbook significance of a placement, not a reading.
var pcPlanetMeaning = {
	sun: "Core self, vitality, what you are here to become.",
	moon: "Instincts, moods, what makes you feel safe.",
	mercury: "Thinking and speaking - how you take information in and pass it on.",
	venus: "Attraction, taste, how you value and relate.",
	mars: "Drive and appetite - how you push, and what you fight for.",
	jupiter: "Growth, luck and belief - where you expand.",
	saturn: "Limits, duty and time - where the work is, and the reward for it.",
	uranus: "Disruption and independence - where you break the pattern.",
	neptune: "Imagination and dissolution - where the edges blur.",
	pluto: "Power and transformation - what is torn down and rebuilt."
}

var pcHouseMeaning = [
	"", // 1-based
	"1st - self, body, how you arrive in a room.",
	"2nd - money, possessions, what you value.",
	"3rd - speech, siblings, short journeys, everyday learning.",
	"4th - home, roots, family, the private self.",
	"5th - play, romance, children, what you make.",
	"6th - work, routine, health, service.",
	"7th - partnership, marriage, open enemies.",
	"8th - shared resources, death and rebirth, what is hidden.",
	"9th - travel, philosophy, higher learning, belief.",
	"10th - career, reputation, standing in the world.",
	"11th - friends, networks, hopes.",
	"12th - solitude, the unconscious, what undoes you."
]

var pcAspectMeaning = {
	"Conjunction": "Fused - the two act as one, for better or worse.",
	"Opposition": "Pulled apart - a tension you balance rather than solve.",
	"Trine": "Easy flow - talent that comes cheaply enough to be taken for granted.",
	"Square": "Friction that forces action. Uncomfortable, and productive.",
	"Sextile": "Opportunity, if you take it up.",
	"Quincunx": "Awkward fit - two things that never quite agree.",
	"Semisextile": "Mild adjustment.",
	"Semisquare": "Low-level irritation that builds.",
	"Sesquiquadrate": "Delayed friction, surfacing under pressure."
}

// Traditional colours for each body. pcPlanetColor() in astrology.js is
// tuned for the 3D solar system - realistic planet surfaces, and no entry for
// the Sun at all, which fell through to grey - so the chart carries its own.
var pcPlanetColors = {
	sun:     "hsl(45 95% 62%)",   // gold
	moon:    "hsl(210 18% 86%)",  // silver
	mercury: "hsl(30 70% 66%)",   // quicksilver orange
	venus:   "hsl(150 55% 62%)",  // green
	mars:    "hsl(5 80% 62%)",    // red
	jupiter: "hsl(275 55% 70%)",  // royal purple
	saturn:  "hsl(35 30% 55%)",   // lead brown
	uranus:  "hsl(185 75% 62%)",  // electric turquoise
	neptune: "hsl(225 70% 68%)",  // sea blue
	pluto:   "hsl(345 45% 52%)"   // dark maroon
}

function pcPlanetColor(key) {
	return pcPlanetColors[key] || "hsl(0 0% 80%)"
}

// One colour per sign rather than one per element: the elements only give four
// and the wheel has twelve slices to tell apart.
var pcSignColors = [
	"hsl(0 75% 62%)",    // Aries - red
	"hsl(120 40% 58%)",  // Taurus - green
	"hsl(52 85% 65%)",   // Gemini - yellow
	"hsl(200 35% 78%)",  // Cancer - moonlit silver-blue
	"hsl(38 90% 60%)",   // Leo - gold
	"hsl(95 35% 55%)",   // Virgo - earth green
	"hsl(330 60% 72%)",  // Libra - rose
	"hsl(350 60% 48%)",  // Scorpio - deep crimson
	"hsl(280 60% 68%)",  // Sagittarius - purple
	"hsl(25 25% 48%)",   // Capricorn - brown
	"hsl(175 70% 58%)",  // Aquarius - teal
	"hsl(255 45% 72%)"   // Pisces - violet
]

function pcSignColor(idx) {
	return pcSignColors[idx] || "hsl(0 0% 70%)"
}

// Reading order. The luminaries first, then the personal planets, then the
// rest - so a house holding the Sun is read before one holding Neptune, and
// the Sun is read before Pluto inside the same house. Not the order the
// ephemeris returns them in, which is by orbit.
var pcPlanetRank = {
	sun: 0, moon: 1, venus: 2, mars: 3, mercury: 4,
	jupiter: 5, saturn: 6, uranus: 7, neptune: 8, pluto: 9
}

function pcRankOf(b) {
	var r = pcPlanetRank[b.key]
	return (r === undefined) ? 99 : r
}

var pcSignMeaning = {
	Aries: "Cardinal fire, ruled by Mars. Starts things; impatient with what it did not start.",
	Taurus: "Fixed earth, ruled by Venus. Steady, sensual, immovable once settled.",
	Gemini: "Mutable air, ruled by Mercury. Curious, quick, two things at once.",
	Cancer: "Cardinal water, ruled by the Moon. Protective, tidal, keeps what matters.",
	Leo: "Fixed fire, ruled by the Sun. Warm, proud, needs to be seen.",
	Virgo: "Mutable earth, ruled by Mercury. Precise, useful, hard on itself.",
	Libra: "Cardinal air, ruled by Venus. Weighs everything; relates rather than acts alone.",
	Scorpio: "Fixed water, ruled by Mars and Pluto. Intense, private, all or nothing.",
	Sagittarius: "Mutable fire, ruled by Jupiter. Restless, candid, chasing the bigger picture.",
	Capricorn: "Cardinal earth, ruled by Saturn. Patient, ambitious, plays the long game.",
	Aquarius: "Fixed air, ruled by Saturn and Uranus. Detached, principled, deliberately odd.",
	Pisces: "Mutable water, ruled by Jupiter and Neptune. Porous, imaginative, hard to pin down."
}

// Hover text rides on a data attribute and is shown by one shared tooltip,
// rather than the browser's title, which takes a second to appear and cannot
// be styled.
function pcTip(text) {
	return ' data-pctip="' + authEsc(text) + '"'
}

function pcListPlanets(chart) {
	var host = document.getElementById("pcPlanets")
	if (host === null) return

	var o = '<div class="pcSectionTitle">Planets at birth</div>'

	if (chart.houses) {
		// Grouped by house, since that is the question being asked, but the
		// planets inside each house keep their Sun-Moon-Mercury order rather
		// than being re-sorted, so the important ones still read first.
		var byHouse = {}
		for (var i = 0; i < chart.bodies.length; i++) {
			var h = chart.bodies[i].house || 0
			if (!byHouse[h]) byHouse[h] = []
			byHouse[h].push(chart.bodies[i])
		}

		// Houses are listed by the most important planet each one holds, not
		// 1 to 12: whichever house the Sun is in is the one to read first,
		// even if that puts House 9 above House 2.
		var blocks = []
		for (var hn = 1; hn <= 12; hn++) {
			var here = byHouse[hn]
			if (!here || !here.length) continue
			here.sort(function (a, b) { return pcRankOf(a) - pcRankOf(b) })
			blocks.push({ house: hn, bodies: here, rank: pcRankOf(here[0]) })
		}
		blocks.sort(function (a, b) { return a.rank - b.rank || a.house - b.house })

		o += '<div class="pcHouses">'
		for (var bi = 0; bi < blocks.length; bi++) {
			var blk = blocks[bi]
			o += '<div class="pcHouseBlock">'
			o += '<div class="pcHouseHead"' + pcTip(pcHouseMeaning[blk.house]) + '>House ' + blk.house + '</div>'
			for (var k = 0; k < blk.bodies.length; k++) o += pcBodyLine(blk.bodies[k])
			o += '</div>'
		}
		o += '</div>'
	} else {
		var flat = chart.bodies.slice()
		flat.sort(function (a, b) { return pcRankOf(a) - pcRankOf(b) })
		o += '<div class="pcHouses">'
		for (var b = 0; b < flat.length; b++) o += pcBodyLine(flat[b])
		o += '</div>'
	}

	if (chart.houses) {
		o += '<div class="pcAngles">'
		o += '<span style="color:' + pcSignColor(chart.ascSign.idx) + '"' + pcTip("Ascendant - the sign rising on the eastern horizon at birth. How you meet the world.") + '>ASC ' + authEsc(astroSigns[chart.ascSign.idx].name) + '</span>'
		o += '<span style="color:' + pcSignColor(chart.mcSign.idx) + '"' + pcTip("Midheaven - the highest point of the chart. Career, reputation, what you are known for.") + '>MC ' + authEsc(astroSigns[chart.mcSign.idx].name) + '</span>'
		o += '</div>'
	} else {
		o += '<div class="profileNote">No birth time, so no houses and no Ascendant. Everything above is still accurate to a fraction of a degree, apart from the Moon.</div>'
	}
	if (chart.sidereal) {
		// Short enough not to set the column's width. The full sentence was the
		// widest thing in the reading, so it alone decided how much room was
		// left for the chart beside it.
		o += '<div class="profileNote pcAyan">Lahiri ayanamsa ' + chart.ayanamsa.toFixed(2) + '&deg;</div>'
	}
	host.innerHTML = o
}

function pcBodyLine(b) {
	var tip = (pcPlanetMeaning[b.key] || "") + (b.retro ? " Retrograde: turned inward, working in reverse." : "")
	var o = '<div class="pcCell"' + pcTip(tip) + '>'
	o += '<span class="pcGlyph" style="color:' + pcPlanetColor(b.key) + '">' + b.glyph + '</span>'
	o += '<span class="pcBody">' + authEsc(b.name) + '</span>'
	var signName = astroSigns[b.signIdx].name
	o += '<span class="pcPos">' + b.deg + '&deg;' + (b.min < 10 ? "0" : "") + b.min + "'</span>"
	o += '<span class="pcSign" style="color:' + pcSignColor(b.signIdx) + '"' + pcTip(signName + " - " + (pcSignMeaning[signName] || "")) + '>' + authEsc(signName) + '</span>'
	if (b.retro) o += '<span class="pcRetro">&#8479;</span>'
	o += '</div>'
	return o
}

function pcListTransits(chart) {
	var host = document.getElementById("pcTransits")
	if (host === null) return
	var t
	try { t = pcTransits(chart, pcZodiac) } catch (e) { host.innerHTML = ""; return }

	var o = '<div class="pcSectionTitle">Transits right now</div>'
	if (t.hits.length === 0) {
		o += '<div class="profileNote">Nothing tight enough to call out today.</div>'
		host.innerHTML = o; return
	}
	o += '<div class="pcTransitList">'
	for (var i = 0; i < t.hits.length; i++) {
		var h = t.hits[i]
		var tip = (pcAspectMeaning[h.aspect.name] || "") +
			" Transiting " + h.t.name + " is contacting your natal " + h.n.name + ". " +
			(pcPlanetMeaning[h.n.key] || "")
		o += '<div class="pcTransit"' + pcTip(tip) + '>'
		o += '<span class="pcGlyph" style="color:' + pcPlanetColor(h.t.key) + '">' + h.t.glyph + '</span>'
		o += '<span class="pcBody">' + authEsc(h.t.name) + '</span>'
		o += '<span class="pcAspect" style="color:' + astroAspectColor(h.aspect.ang) + '">' + authEsc(h.aspect.name) + '</span>'
		o += '<span class="pcGlyph" style="color:' + pcPlanetColor(h.n.key) + '">' + h.n.glyph + '</span>'
		o += '<span class="pcBody">natal ' + authEsc(h.n.name) + '</span>'
		o += '<span class="pcOrb">' + h.orb.toFixed(1) + '&deg;</span>'
		o += '</div>'
	}
	o += '</div>'
	o += '<div class="profileNote">Slow movers within 3&deg;. Hover any line for what it means.</div>'
	host.innerHTML = o
}

// ---- hover explanations -------------------------------------------------
//
// One tooltip element reused for every hover, following the pointer and
// hidden on the way out. Bound through a delegated handler so it survives the
// redraws this tab does on every keystroke.

function pcTipShow(e) {
	var text = e.currentTarget.getAttribute("data-pctip")
	if (!text) return
	var tip = document.getElementById("pcTipBox")
	if (tip === null) {
		tip = document.createElement("div")
		tip.id = "pcTipBox"
		tip.className = "pcTipBox"
		document.body.appendChild(tip)
	}
	tip.textContent = text
	tip.classList.remove("hideValue")
	pcTipMove(e)
}

function pcTipMove(e) {
	var tip = document.getElementById("pcTipBox")
	if (tip === null) return
	var pad = 14
	var x = e.clientX + pad, y = e.clientY + pad
	if (x + tip.offsetWidth > window.innerWidth - 8) x = e.clientX - tip.offsetWidth - pad
	if (y + tip.offsetHeight > window.innerHeight - 8) y = e.clientY - tip.offsetHeight - pad
	tip.style.left = Math.max(4, x) + "px"
	tip.style.top = Math.max(4, y) + "px"
}

function pcTipHide() {
	var tip = document.getElementById("pcTipBox")
	if (tip !== null) tip.classList.add("hideValue")
}

$(document).ready(function () {
	$("body").on("mouseenter", "[data-pctip]", pcTipShow)
	$("body").on("mousemove", "[data-pctip]", pcTipMove)
	$("body").on("mouseleave", "[data-pctip]", pcTipHide)
})

// ---- place lookup ------------------------------------------------------

// Reuses the Astrology tab's geocoder rather than a second one: same URL
// builder, same parser, same OpenStreetMap attribution.
var pcGeoResults = []

function pcLookupPlace() {
	pcCapture()
	var host = document.getElementById("pcGeo")
	if (host === null) return
	var q = pcForm.place.trim()
	if (q === "") { host.innerHTML = ""; return }
	if (typeof astroGeoUrl !== "function") {
		host.innerHTML = '<div class="profileNote">Enter the coordinates below.</div>'
		return
	}

	host.innerHTML = '<div class="profileLoading">Searching&hellip;</div>'
	fetch(astroGeoUrl(q), { headers: { "Accept": "application/json" } })
		.then(function (r) { return r.json() })
		.then(function (data) {
			var hits = astroGeoParse(data)
			if (!hits.length) {
				host.innerHTML = '<div class="profileNote">No match. Try adding a country, or enter the coordinates below.</div>'
				return
			}
			pcGeoResults = hits
			var o = '<div class="profileList">'
			for (var i = 0; i < hits.length && i < 5; i++) {
				o += '<div class="profileRow"><span class="profileRowPhrase" onclick="pcPickPlace(' + i + ')">' + authEsc(hits[i].label)
				o += '<span class="profileWhen"> ' + hits[i].lat.toFixed(3) + ', ' + hits[i].lon.toFixed(3) + '</span></span></div>'
			}
			o += '</div><div class="profileNote">Search by OpenStreetMap / Nominatim</div>'
			host.innerHTML = o
		})
		.catch(function () {
			host.innerHTML = '<div class="profileNote profileWarn">Lookup failed. Enter the coordinates below.</div>'
		})
}

function pcPickPlace(i) {
	var r = pcGeoResults[i]
	if (!r) return
	pcCapture()
	pcForm.place = r.label
	pcForm.lat = r.lat
	pcForm.lon = r.lon
	renderProfileChart()
}

// ---- saving ------------------------------------------------------------

function pcSave() {
	pcCapture()
	var f = pcForm
	if (!f.name.trim()) { displayCalcNotification("Give the chart a name", 1800); return }

	var pad = function (n) { return (String(n).length < 2 ? "0" : "") + n }
	chartSave(f.name.trim(), {
		birth_date: f.y + "-" + pad(f.m) + "-" + pad(f.d),
		birth_time: f.timeKnown ? (pad(f.hh) + ":" + pad(f.mm)) : "",
		place: f.usePlace ? f.place : "",
		latitude: f.usePlace ? f.lat : null,
		longitude: f.usePlace ? f.lon : null,
		tz_offset: f.usePlace ? f.tz : null,
		zodiac: pcZodiac,
		time_known: f.timeKnown,
		use_place: f.usePlace
	}).then(function (what) {
		displayCalcNotification(what === "updated" ? "Chart updated" : "Chart saved", 1800)
		renderProfileChart()
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not save the chart", 2600)
	})
}

function pcOpen(id) {
	chartList().then(function (rows) {
		var r = null
		for (var i = 0; i < rows.length; i++) if (rows[i].id === id) { r = rows[i]; break }
		if (r === null) throw new Error("That chart is gone")

		var parts = String(r.birth_date).split("-")
		var time = String(r.birth_time || "").split(":")
		pcForm = {
			name: r.name,
			y: Number(parts[0]) || 2000, m: Number(parts[1]) || 1, d: Number(parts[2]) || 1,
			hh: Number(time[0]) || 12, mm: Number(time[1]) || 0,
			timeKnown: r.time_known !== false,
			usePlace: r.use_place !== false,
			place: r.place || "",
			lat: (r.latitude === null || r.latitude === undefined) ? 51.5074 : r.latitude,
			lon: (r.longitude === null || r.longitude === undefined) ? -0.1278 : r.longitude,
			tz: (r.tz_offset === null || r.tz_offset === undefined) ? 0 : r.tz_offset
		}
		pcEditingId = r.id
		if (r.zodiac === "sidereal" || r.zodiac === "tropical") pcZodiac = r.zodiac
		renderProfileChart()
	}).catch(function (err) {
		displayCalcNotification(err.message || "Could not open the chart", 2400)
	})
}

function pcNew() {
	pcForm = pcDefaultForm()
	pcEditingId = null
	renderProfileChart()
}

function pcDelete(btn, id) {
	if (!profileConfirmClick(btn)) return
	chartDelete(id).then(function () {
		if (pcEditingId === id) { pcEditingId = null }
		renderProfileChart()
	}).catch(function (err) { profileBody(profileErr(err)) })
}

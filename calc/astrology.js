// ========================= Astrology =============================
//
// Geocentric ecliptic longitudes for the Sun, Moon and planets, from the
// classical orbital-element method (Paul Schlyter's formulation) including the
// standard perturbation terms for the Moon, Jupiter, Saturn and Uranus, plus
// the periodic series for Pluto.
//
// Accuracy: roughly 1-2 arcminutes for the Sun and Moon and a few arcminutes
// for the planets. Signs, degrees and aspects are far inside that margin.
// Pluto's series is only valid 1800-2100, which is flagged in the UI.

var astroMenuOpened = false
var astroLastChart = null // most recent chart, shared with the visualiser

var astroSigns = [
	{ name: "Aries",       glyph: "♈", el: "Fire"  },
	{ name: "Taurus",      glyph: "♉", el: "Earth" },
	{ name: "Gemini",      glyph: "♊", el: "Air"   },
	{ name: "Cancer",      glyph: "♋", el: "Water" },
	{ name: "Leo",         glyph: "♌", el: "Fire"  },
	{ name: "Virgo",       glyph: "♍", el: "Earth" },
	{ name: "Libra",       glyph: "♎", el: "Air"   },
	{ name: "Scorpio",     glyph: "♏", el: "Water" },
	{ name: "Sagittarius", glyph: "♐", el: "Fire"  },
	{ name: "Capricorn",   glyph: "♑", el: "Earth" },
	{ name: "Aquarius",    glyph: "♒", el: "Air"   },
	{ name: "Pisces",      glyph: "♓", el: "Water" }
]

var astroBodies = [
	{ key: "sun",     name: "Sun",     glyph: "☉" },
	{ key: "moon",    name: "Moon",    glyph: "☽" },
	{ key: "mercury", name: "Mercury", glyph: "☿" },
	{ key: "venus",   name: "Venus",   glyph: "♀" },
	{ key: "mars",    name: "Mars",    glyph: "♂" },
	{ key: "jupiter", name: "Jupiter", glyph: "♃" },
	{ key: "saturn",  name: "Saturn",  glyph: "♄" },
	{ key: "uranus",  name: "Uranus",  glyph: "♅" },
	{ key: "neptune", name: "Neptune", glyph: "♆" },
	{ key: "pluto",   name: "Pluto",   glyph: "♇" }
]

// aspect angle, name, glyph and orb in degrees
var astroAspects = [
	{ ang: 0,   name: "Conjunction", glyph: "☌", orb: 8 },
	{ ang: 60,  name: "Sextile",     glyph: "⚹", orb: 4 },
	{ ang: 90,  name: "Square",      glyph: "□", orb: 6 },
	{ ang: 120, name: "Trine",       glyph: "△", orb: 6 },
	{ ang: 180, name: "Opposition",  glyph: "☍", orb: 8 }
]

// ---- maths helpers ----------------------------------------------------

var DEG = Math.PI / 180
function aSin(x) { return Math.sin(x * DEG) }
function aCos(x) { return Math.cos(x * DEG) }
function aRev(x) { return x - Math.floor(x / 360) * 360 } // normalise to 0-360
function aAtan2(y, x) { return aRev(Math.atan2(y, x) / DEG) }

// day number counted from 2000 Jan 0.0 TDT, with fractional UT hours
function astroDayNumber(y, m, D, ut) {
	var d = 367 * y
		- Math.floor(7 * (y + Math.floor((m + 9) / 12)) / 4)
		+ Math.floor(275 * m / 9) + D - 730530
	return d + ut / 24.0
}

// solve Kepler's equation, iterating for the eccentric orbits (Moon)
function astroEccentricAnomaly(M, e) {
	var E = M + (180 / Math.PI) * e * aSin(M) * (1 + e * aCos(M))
	if (e < 0.06) return E
	var E0, i = 0
	do {
		E0 = E
		E = E0 - (E0 - (180 / Math.PI) * e * aSin(E0) - M) / (1 - e * aCos(E0))
		i++
	} while (Math.abs(E - E0) > 0.0005 && i < 30)
	return E
}

// ---- element sets -----------------------------------------------------

function astroElements(body, d) {
	switch (body) {
		case "sun":     return { N: 0.0, i: 0.0, w: 282.9404 + 4.70935e-5 * d, a: 1.000000, e: 0.016709 - 1.151e-9 * d, M: 356.0470 + 0.9856002585 * d }
		case "moon":    return { N: 125.1228 - 0.0529538083 * d, i: 5.1454, w: 318.0634 + 0.1643573223 * d, a: 60.2666, e: 0.054900, M: 115.3654 + 13.0649929509 * d }
		case "mercury": return { N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5.00e-8 * d, w: 29.1241 + 1.01444e-5 * d, a: 0.387098, e: 0.205635 + 5.59e-10 * d, M: 168.6562 + 4.0923344368 * d }
		case "venus":   return { N: 76.6799 + 2.46590e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.8910 + 1.38374e-5 * d, a: 0.723330, e: 0.006773 - 1.302e-9 * d, M: 48.0052 + 1.6021302244 * d }
		case "mars":    return { N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: 18.6021 + 0.5240207766 * d }
		case "jupiter": return { N: 100.4542 + 2.76854e-5 * d, i: 1.3030 - 1.557e-7 * d, w: 273.8777 + 1.64505e-5 * d, a: 5.20256, e: 0.048498 + 4.469e-9 * d, M: 19.8950 + 0.0830853001 * d }
		case "saturn":  return { N: 113.6634 + 2.38980e-5 * d, i: 2.4886 - 1.081e-7 * d, w: 339.3939 + 2.97661e-5 * d, a: 9.55475, e: 0.055546 - 9.499e-9 * d, M: 316.9670 + 0.0334442282 * d }
		case "uranus":  return { N: 74.0005 + 1.3978e-5 * d, i: 0.7733 + 1.9e-8 * d, w: 96.6612 + 3.0565e-5 * d, a: 19.18171 - 1.55e-8 * d, e: 0.047318 + 7.45e-9 * d, M: 142.5905 + 0.011725806 * d }
		case "neptune": return { N: 131.7806 + 3.0173e-5 * d, i: 1.7700 - 2.55e-7 * d, w: 272.8461 - 6.027e-6 * d, a: 30.05826 + 3.313e-8 * d, e: 0.008606 + 2.15e-9 * d, M: 260.2471 + 0.005995147 * d }
	}
	return null
}

// heliocentric rectangular ecliptic coordinates
function astroHelio(body, d) {
	var o = astroElements(body, d)
	var M = aRev(o.M)
	var E = astroEccentricAnomaly(M, o.e)
	var xv = o.a * (aCos(E) - o.e)
	var yv = o.a * Math.sqrt(1 - o.e * o.e) * aSin(E)
	var v = aAtan2(yv, xv)
	var r = Math.sqrt(xv * xv + yv * yv)
	var l = v + o.w
	return {
		x: r * (aCos(o.N) * aCos(l) - aSin(o.N) * aSin(l) * aCos(o.i)),
		y: r * (aSin(o.N) * aCos(l) + aCos(o.N) * aSin(l) * aCos(o.i)),
		z: r * (aSin(l) * aSin(o.i)),
		r: r, v: v, N: o.N, w: o.w, i: o.i, M: M
	}
}

function astroSunRect(d) {
	var o = astroElements("sun", d)
	var M = aRev(o.M)
	var E = astroEccentricAnomaly(M, o.e)
	var xv = aCos(E) - o.e
	var yv = Math.sqrt(1 - o.e * o.e) * aSin(E)
	var v = aAtan2(yv, xv)
	var r = Math.sqrt(xv * xv + yv * yv)
	var lon = aRev(v + o.w)
	return { x: r * aCos(lon), y: r * aSin(lon), r: r, lon: lon, M: M, w: o.w }
}

// geocentric ecliptic longitude of one body, degrees 0-360
function astroLongitude(body, d) {

	if (body === "sun") return astroSunRect(d).lon

	if (body === "moon") {
		var o = astroElements("moon", d)
		var Mm = aRev(o.M), Nm = aRev(o.N), wm = aRev(o.w)
		var E = astroEccentricAnomaly(Mm, o.e)
		var xv = o.a * (aCos(E) - o.e)
		var yv = o.a * Math.sqrt(1 - o.e * o.e) * aSin(E)
		var v = aAtan2(yv, xv)
		var r = Math.sqrt(xv * xv + yv * yv)
		var l = v + wm
		var xh = r * (aCos(Nm) * aCos(l) - aSin(Nm) * aSin(l) * aCos(o.i))
		var yh = r * (aSin(Nm) * aCos(l) + aCos(Nm) * aSin(l) * aCos(o.i))
		var lon = aAtan2(yh, xh)

		// perturbations: without these the Moon can be off by half a degree
		var sun = astroSunRect(d)
		var Ms = sun.M
		var Ls = aRev(Ms + sun.w)
		var Lm = aRev(Mm + wm + Nm)
		var Dm = aRev(Lm - Ls)          // mean elongation
		var F = aRev(Lm - Nm)           // argument of latitude

		lon += -1.274 * aSin(Mm - 2 * Dm)      // evection
		lon += +0.658 * aSin(2 * Dm)           // variation
		lon += -0.186 * aSin(Ms)               // yearly equation
		lon += -0.059 * aSin(2 * Mm - 2 * Dm)
		lon += -0.057 * aSin(Mm - 2 * Dm + Ms)
		lon += +0.053 * aSin(Mm + 2 * Dm)
		lon += +0.046 * aSin(2 * Dm - Ms)
		lon += +0.041 * aSin(Mm - Ms)
		lon += -0.035 * aSin(Dm)               // parallactic equation
		lon += -0.031 * aSin(Mm + Ms)
		lon += -0.015 * aSin(2 * F - 2 * Dm)
		lon += +0.011 * aSin(Mm - 4 * Dm)
		return aRev(lon)
	}

	if (body === "pluto") {
		// periodic series, heliocentric; only valid roughly 1800-2100
		var S = 50.03 + 0.033459652 * d
		var P = 238.95 + 0.003968789 * d
		var lonecl = 238.9508 + 0.00400703 * d
			- 19.799 * aSin(P) + 19.848 * aCos(P)
			+ 0.897 * aSin(2 * P) - 4.956 * aCos(2 * P)
			+ 0.610 * aSin(3 * P) + 1.211 * aCos(3 * P)
			- 0.341 * aSin(4 * P) - 0.190 * aCos(4 * P)
			+ 0.128 * aSin(5 * P) - 0.034 * aCos(5 * P)
			- 0.038 * aSin(6 * P) + 0.031 * aCos(6 * P)
			+ 0.020 * aSin(P - S) - 0.010 * aCos(P - S)
		var latecl = -3.9082
			- 5.453 * aSin(P) - 14.975 * aCos(P)
			+ 3.527 * aSin(2 * P) + 1.673 * aCos(2 * P)
			- 1.051 * aSin(3 * P) + 0.328 * aCos(3 * P)
			+ 0.179 * aSin(4 * P) - 0.292 * aCos(4 * P)
			+ 0.019 * aSin(5 * P) + 0.100 * aCos(5 * P)
			- 0.031 * aSin(6 * P) - 0.026 * aCos(6 * P)
			+ 0.011 * aCos(P - S)
		var rp = 40.72
			+ 6.68 * aSin(P) + 6.90 * aCos(P)
			- 1.18 * aSin(2 * P) - 0.03 * aCos(2 * P)
			+ 0.15 * aSin(3 * P) - 0.14 * aCos(3 * P)

		var xh = rp * aCos(lonecl) * aCos(latecl)
		var yh = rp * aSin(lonecl) * aCos(latecl)
		var s = astroSunRect(d)
		return aAtan2(yh + s.y, xh + s.x)
	}

	// remaining planets: heliocentric, then shifted to geocentric
	var p = astroHelio(body, d)
	var lonH = aAtan2(p.y, p.x)
	var latH = aAtan2(p.z, Math.sqrt(p.x * p.x + p.y * p.y))
	var rH = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)

	// giant-planet perturbations
	if (body === "jupiter" || body === "saturn" || body === "uranus") {
		var Mj = aRev(astroElements("jupiter", d).M)
		var Msa = aRev(astroElements("saturn", d).M)
		var Mu = aRev(astroElements("uranus", d).M)
		if (body === "jupiter") {
			lonH += -0.332 * aSin(2 * Mj - 5 * Msa - 67.6)
			lonH += -0.056 * aSin(2 * Mj - 2 * Msa + 21)
			lonH += +0.042 * aSin(3 * Mj - 5 * Msa + 21)
			lonH += -0.036 * aSin(Mj - 2 * Msa)
			lonH += +0.022 * aCos(Mj - Msa)
			lonH += +0.023 * aSin(2 * Mj - 3 * Msa + 52)
			lonH += -0.016 * aSin(Mj - 5 * Msa - 69)
		} else if (body === "saturn") {
			lonH += +0.812 * aSin(2 * Mj - 5 * Msa - 67.6)
			lonH += -0.229 * aCos(2 * Mj - 4 * Msa - 2)
			lonH += +0.119 * aSin(Mj - 2 * Msa - 3)
			lonH += +0.046 * aSin(2 * Mj - 6 * Msa - 69)
			lonH += +0.014 * aSin(Mj - 3 * Msa + 32)
			latH += -0.020 * aCos(2 * Mj - 4 * Msa - 2)
			latH += +0.018 * aSin(2 * Mj - 6 * Msa - 49)
		} else {
			lonH += +0.040 * aSin(Msa - 2 * Mu + 6)
			lonH += +0.035 * aSin(Msa - 3 * Mu + 33)
			lonH += -0.015 * aSin(Mj - Mu + 20)
		}
	}

	var xh2 = rH * aCos(lonH) * aCos(latH)
	var yh2 = rH * aSin(lonH) * aCos(latH)
	var sun2 = astroSunRect(d)
	return aAtan2(yh2 + sun2.y, xh2 + sun2.x)
}

// ---- sidereal time, angles and houses ---------------------------------

// mean obliquity of the ecliptic
function astroObliquity(d) { return 23.4393 - 3.563e-7 * d }

// Local sidereal time in degrees. Derived from the Sun's mean longitude, which
// keeps it consistent with the element set used everywhere else here.
function astroLST(d, ut, lonEast) {
	var o = astroElements("sun", d)
	var Ls = aRev(o.M + o.w)      // Sun's mean longitude
	var GMST0 = aRev(Ls + 180)
	return aRev(GMST0 + ut * 15 + lonEast)
}

// Ascendant, Midheaven and the twelve house cusps.
// RAMC is the right ascension of the MC, which equals local sidereal time.
function astroHouses(ramc, lat, ecl, system) {
	if (lat > 89.5) lat = 89.5      // tan(lat) diverges at the poles
	if (lat < -89.5) lat = -89.5

	var mc = aAtan2(aSin(ramc), aCos(ramc) * aCos(ecl))
	var asc = aAtan2(aCos(ramc), -(aSin(ramc) * aCos(ecl) + Math.tan(lat * DEG) * aSin(ecl)))

	var cusps = [], i
	if (system === "whole") {
		var start = Math.floor(asc / 30) * 30 // house 1 is the whole sign holding the Ascendant
		for (i = 0; i < 12; i++) cusps.push(aRev(start + i * 30))
	} else { // equal
		for (i = 0; i < 12; i++) cusps.push(aRev(asc + i * 30))
	}
	return { asc: asc, mc: mc, cusps: cusps, system: system }
}

function astroHouseOf(lon, cusps) {
	for (var i = 0; i < 12; i++) {
		var span = aRev(cusps[(i + 1) % 12] - cusps[i])
		if (span === 0) span = 360
		if (aRev(lon - cusps[i]) < span) return i + 1
	}
	return 1
}

// ---- chart assembly ---------------------------------------------------

function astroSignOf(lon) {
	var idx = Math.floor(aRev(lon) / 30)
	var within = aRev(lon) - idx * 30
	var deg = Math.floor(within)
	var min = Math.floor((within - deg) * 60)
	return { idx: idx, sign: astroSigns[idx], deg: deg, min: min, within: within }
}

function astroMoonPhase(sunLon, moonLon) {
	var elong = aRev(moonLon - sunLon)
	var illum = (1 - aCos(elong)) / 2 // 0 new, 1 full
	var name
	if (elong < 22.5 || elong >= 337.5) name = "New Moon"
	else if (elong < 67.5) name = "Waxing Crescent"
	else if (elong < 112.5) name = "First Quarter"
	else if (elong < 157.5) name = "Waxing Gibbous"
	else if (elong < 202.5) name = "Full Moon"
	else if (elong < 247.5) name = "Waning Gibbous"
	else if (elong < 292.5) name = "Last Quarter"
	else name = "Waning Crescent"
	return { name: name, elong: elong, illum: illum }
}

// Full chart for a UTC moment. Pass loc to cast a birth chart:
//   { lat: degrees north, lon: degrees east, system: "whole" | "equal" }
function astroChart(y, m, D, ut, loc) {
	var d = astroDayNumber(y, m, D, ut)
	var step = 0.5 // half a day, enough to see direction of motion
	var out = { d: d, bodies: [], aspects: [], plutoOutOfRange: (y < 1800 || y > 2100) }

	for (var i = 0; i < astroBodies.length; i++) {
		var b = astroBodies[i]
		var lon = astroLongitude(b.key, d)
		var lonNext = astroLongitude(b.key, d + step)
		var motion = aRev(lonNext - lon)
		if (motion > 180) motion -= 360 // signed daily motion
		var s = astroSignOf(lon)
		out.bodies.push({
			key: b.key, name: b.name, glyph: b.glyph,
			lon: lon, sign: s.sign, signIdx: s.idx, deg: s.deg, min: s.min,
			retro: (motion < 0), speed: motion / step
		})
	}

	out.phase = astroMoonPhase(out.bodies[0].lon, out.bodies[1].lon)

	// birth chart angles, only when a location was supplied
	if (loc && isFinite(loc.lat) && isFinite(loc.lon)) {
		var ecl = astroObliquity(d)
		var ramc = astroLST(d, ut, loc.lon)
		out.houses = astroHouses(ramc, loc.lat, ecl, loc.system || "whole")
		out.houses.ramc = ramc
		out.houses.obliquity = ecl
		out.ascSign = astroSignOf(out.houses.asc)
		out.mcSign = astroSignOf(out.houses.mc)
		for (var h = 0; h < out.bodies.length; h++) {
			out.bodies[h].house = astroHouseOf(out.bodies[h].lon, out.houses.cusps)
		}
	}

	// aspect grid
	for (var a = 0; a < out.bodies.length; a++) {
		for (var b2 = a + 1; b2 < out.bodies.length; b2++) {
			var sep = Math.abs(aRev(out.bodies[a].lon - out.bodies[b2].lon))
			if (sep > 180) sep = 360 - sep
			for (var k = 0; k < astroAspects.length; k++) {
				var asp = astroAspects[k]
				var delta = Math.abs(sep - asp.ang)
				if (delta <= asp.orb) {
					out.aspects.push({
						a: out.bodies[a], b: out.bodies[b2],
						aspect: asp, orb: delta, exact: (delta < 1)
					})
					break
				}
			}
		}
	}
	out.aspects.sort(function (x, y2) { return x.orb - y2.orb })
	return out
}

// ---- heliocentric positions (for the 3D view) -------------------------

// Bodies that actually orbit the Sun, in order outward. The Moon is drawn as a
// satellite of Earth rather than as its own orbit.
var astroOrbitBodies = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]

function astroPlutoHelio(d) {
	var S = 50.03 + 0.033459652 * d
	var P = 238.95 + 0.003968789 * d
	var lonecl = 238.9508 + 0.00400703 * d
		- 19.799 * aSin(P) + 19.848 * aCos(P)
		+ 0.897 * aSin(2 * P) - 4.956 * aCos(2 * P)
		+ 0.610 * aSin(3 * P) + 1.211 * aCos(3 * P)
		- 0.341 * aSin(4 * P) - 0.190 * aCos(4 * P)
		+ 0.128 * aSin(5 * P) - 0.034 * aCos(5 * P)
		- 0.038 * aSin(6 * P) + 0.031 * aCos(6 * P)
		+ 0.020 * aSin(P - S) - 0.010 * aCos(P - S)
	var latecl = -3.9082
		- 5.453 * aSin(P) - 14.975 * aCos(P)
		+ 3.527 * aSin(2 * P) + 1.673 * aCos(2 * P)
		- 1.051 * aSin(3 * P) + 0.328 * aCos(3 * P)
		+ 0.179 * aSin(4 * P) - 0.292 * aCos(4 * P)
		+ 0.019 * aSin(5 * P) + 0.100 * aCos(5 * P)
		- 0.031 * aSin(6 * P) - 0.026 * aCos(6 * P)
		+ 0.011 * aCos(P - S)
	var r = 40.72
		+ 6.68 * aSin(P) + 6.90 * aCos(P)
		- 1.18 * aSin(2 * P) - 0.03 * aCos(2 * P)
		+ 0.15 * aSin(3 * P) - 0.14 * aCos(3 * P)
	return {
		x: r * aCos(lonecl) * aCos(latecl),
		y: r * aSin(lonecl) * aCos(latecl),
		z: r * aSin(latecl)
	}
}

function astroHelioPos(body, d) {
	if (body === "earth") { // Earth sits opposite the Sun as seen from Earth
		var s = astroSunRect(d)
		return { x: -s.x, y: -s.y, z: 0 }
	}
	if (body === "pluto") return astroPlutoHelio(d)
	var p = astroHelio(body, d)
	return { x: p.x, y: p.y, z: p.z }
}

// Sample a full orbit by sweeping mean anomaly, keeping the other elements
// fixed. Good enough to draw the ellipse in the right plane and orientation.
function astroOrbitPath(body, d, steps) {
	var pts = [], i
	if (body === "pluto") { // no elements, sweep its own periodic argument
		for (i = 0; i <= steps; i++) {
			pts.push(astroPlutoHelio(d + (i / steps) * 90000)) // ~248 year period
		}
		return pts
	}
	var src = (body === "earth") ? "sun" : body
	var o = astroElements(src, d)
	for (i = 0; i <= steps; i++) {
		var M = (i / steps) * 360
		var E = astroEccentricAnomaly(M, o.e)
		var xv = o.a * (aCos(E) - o.e)
		var yv = o.a * Math.sqrt(1 - o.e * o.e) * aSin(E)
		var v = aAtan2(yv, xv)
		var r = Math.sqrt(xv * xv + yv * yv)
		var l = v + o.w
		var pt = {
			x: r * (aCos(o.N) * aCos(l) - aSin(o.N) * aSin(l) * aCos(o.i)),
			y: r * (aSin(o.N) * aCos(l) + aCos(o.N) * aSin(l) * aCos(o.i)),
			z: r * (aSin(l) * aSin(o.i))
		}
		if (body === "earth") { pt.x = -pt.x; pt.y = -pt.y; pt.z = 0 }
		pts.push(pt)
	}
	return pts
}

// ---- UI ---------------------------------------------------------------

// ---- chart visualiser -------------------------------------------------

var astroViewMode = "2d"      // "2d" wheel or "3d" solar system
var astroAzimuth = -35        // 3D camera, degrees
var astroElevation = 62
var astroDragging = false
var astroDragX = 0, astroDragY = 0
var astroZoom = 1        // 3D camera distance, 1 fits Pluto's orbit
var astroZoomMin = 0.45
var astroZoomMax = 14

function astroSetView(mode) {
	astroViewMode = mode
	$(".astroViewBtn").removeClass("astroViewOn")
	$("#astroView" + mode.toUpperCase()).addClass("astroViewOn")
	$("#astroDragHint").toggleClass("hideValue", mode !== "3d")
	drawAstroVisual()
}

function astroSetZoom(z) {
	astroZoom = Math.max(astroZoomMin, Math.min(astroZoomMax, z))
	var lbl = document.getElementById("astroZoomLabel")
	if (lbl !== null) lbl.textContent = astroZoom.toFixed(2) + "x"
	drawAstroVisual()
}

function astroZoomBy(factor) { astroSetZoom(astroZoom * factor) }
function astroResetView() { astroZoom = 1; astroAzimuth = -35; astroElevation = 62; astroSetZoom(1) }


// Wheel zoom needs a native, explicitly non-passive listener. Browsers treat
// wheel handlers registered through jQuery's delegation as passive, so
// preventDefault() is ignored there and the page scrolls behind the zoom.
function astroBindCanvasWheel() {
	var cvs = document.getElementById("astroCanvas")
	if (cvs === null || cvs.dataset.wheelBound === "1") return
	cvs.addEventListener("wheel", function (e) {
		if (astroViewMode !== "3d") return
		e.preventDefault()
		e.stopPropagation()
		astroSetZoom(astroZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
	}, { passive: false })
	cvs.dataset.wheelBound = "1"
}

function astroCanvasSetup() {
	var cvs = document.getElementById("astroCanvas")
	if (cvs === null) return null
	var dpr = window.devicePixelRatio || 1
	var cw = cvs.clientWidth || 520
	var ch = cvs.clientHeight || 460
	cvs.width = Math.floor(cw * dpr)
	cvs.height = Math.floor(ch * dpr)
	var c = cvs.getContext("2d")
	c.setTransform(dpr, 0, 0, dpr, 0, 0)
	c.clearRect(0, 0, cw, ch)
	return { ctx: c, w: cw, h: ch }
}

function drawAstroVisual() {
	var s = astroCanvasSetup()
	if (s === null || astroLastChart === null) return
	if (astroViewMode === "3d") drawAstroChart3D(s.ctx, s.w, s.h, astroLastChart)
	else drawAstroChart2D(s.ctx, s.w, s.h, astroLastChart)
}

function astroCssVar(name, fallback) {
	var v = getComputedStyle(document.documentElement).getPropertyValue(name)
	return (v && v.trim()) ? v.trim() : fallback
}

// The wheel is drawn the traditional way: Ascendant at the left, longitude
// increasing anticlockwise so house 1 falls below the horizon line.
function astroWheelAngle(lon, rotation) { return 180 + (lon - rotation) }

function astroPolar(cx, cy, r, angDeg) {
	return { x: cx + r * aCos(angDeg), y: cy - r * aSin(angDeg) }
}

function drawAstroChart2D(c, w, h, chart) {
	var cx = w / 2, cy = h / 2
	var R = Math.min(w, h) / 2 - 12
	var rSignOuter = R
	var rSignInner = R * 0.84
	var rHouse = R * 0.66
	var rPlanet = R * 0.74
	var rAspect = R * 0.62

	var rotation = chart.houses ? chart.houses.asc : 0
	var faint = astroCssVar("--border-dark-accent", "#3a3a3a")
	var line = astroCssVar("--separator-accent2", "#555")
	var text = astroCssVar("--font-white-2", "#d0d0d0")
	var dim = astroCssVar("--font-white-3", "#999")

	c.lineWidth = 1

	// zodiac ring
	c.strokeStyle = line
	;[rSignOuter, rSignInner, rHouse].forEach(function (r) {
		c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke()
	})

	for (var s = 0; s < 12; s++) {
		var a0 = astroWheelAngle(s * 30, rotation)
		var p0 = astroPolar(cx, cy, rSignInner, a0)
		var p1 = astroPolar(cx, cy, rSignOuter, a0)
		c.strokeStyle = line
		c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke()

		var mid = astroWheelAngle(s * 30 + 15, rotation)
		var pm = astroPolar(cx, cy, (rSignInner + rSignOuter) / 2, mid)
		c.fillStyle = astroSignColor(s)
		c.font = "16px " + astroCssVar("--font-family", "sans-serif") + ", sans-serif"
		c.textAlign = "center"; c.textBaseline = "middle"
		c.fillText(astroSigns[s].glyph, pm.x, pm.y)
	}

	// house cusps
	if (chart.houses) {
		for (var hI = 0; hI < 12; hI++) {
			var ha = astroWheelAngle(chart.houses.cusps[hI], rotation)
			var q0 = astroPolar(cx, cy, rAspect, ha)
			var q1 = astroPolar(cx, cy, rSignInner, ha)
			var angular = (hI % 3 === 0)
			c.strokeStyle = angular ? line : faint
			c.lineWidth = angular ? 1.6 : 1
			c.beginPath(); c.moveTo(q0.x, q0.y); c.lineTo(q1.x, q1.y); c.stroke()

			var lm = astroWheelAngle(chart.houses.cusps[hI] + 15, rotation)
			var pl = astroPolar(cx, cy, (rAspect + rHouse) / 2, lm)
			c.fillStyle = dim
			c.font = "10px sans-serif"
			c.fillText(String(hI + 1), pl.x, pl.y)
		}
		c.lineWidth = 1

		// Ascendant marker
		var ap = astroPolar(cx, cy, rSignOuter, 180)
		c.strokeStyle = astroCssVar("--focus-outline", "#bbb")
		c.lineWidth = 2
		c.beginPath(); c.moveTo(cx - rAspect, cy); c.lineTo(ap.x - 2, ap.y); c.stroke()
		c.fillStyle = astroCssVar("--focus-outline", "#bbb")
		c.font = "10px sans-serif"; c.textAlign = "left"
		c.fillText("ASC", cx - rSignOuter + 2, cy - 8)
		c.lineWidth = 1
	}

	// aspect lines
	for (var k = 0; k < chart.aspects.length; k++) {
		var asp = chart.aspects[k]
		var pa = astroPolar(cx, cy, rAspect, astroWheelAngle(asp.a.lon, rotation))
		var pb = astroPolar(cx, cy, rAspect, astroWheelAngle(asp.b.lon, rotation))
		c.strokeStyle = astroAspectColor(asp.aspect.ang)
		c.globalAlpha = asp.exact ? 0.85 : 0.4
		c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke()
	}
	c.globalAlpha = 1

	// planets, nudged apart when they stack up
	var placed = []
	for (var i = 0; i < chart.bodies.length; i++) {
		var b = chart.bodies[i]
		var ang = astroWheelAngle(b.lon, rotation)
		var rr = rPlanet
		for (var t = 0; t < placed.length; t++) {
			if (Math.abs(aRev(placed[t].ang - ang + 180) - 180) < 7 && Math.abs(placed[t].r - rr) < 12) {
				rr -= 15; t = -1
			}
		}
		placed.push({ ang: ang, r: rr })

		var tick0 = astroPolar(cx, cy, rHouse, ang)
		var tick1 = astroPolar(cx, cy, rHouse + 6, ang)
		c.strokeStyle = astroSignColor(b.signIdx)
		c.beginPath(); c.moveTo(tick0.x, tick0.y); c.lineTo(tick1.x, tick1.y); c.stroke()

		var pp = astroPolar(cx, cy, rr, ang)
		c.fillStyle = b.retro ? astroCssVar("--font-white-3", "#aaa") : text
		c.font = "15px sans-serif"
		c.textAlign = "center"; c.textBaseline = "middle"
		c.fillText(b.glyph, pp.x, pp.y)
		if (b.retro) {
			c.font = "8px sans-serif"
			c.fillText("R", pp.x + 9, pp.y + 7)
		}
	}

	// centre readout
	c.fillStyle = dim
	c.font = "10px sans-serif"; c.textAlign = "center"
	c.fillText(chart.phase.name, cx, cy - 6)
	c.fillText((chart.phase.illum * 100).toFixed(0) + "%", cx, cy + 7)
}

function astroAspectColor(ang) {
	if (ang === 0) return "hsl(45 70% 60%)"
	if (ang === 60) return "hsl(190 60% 58%)"
	if (ang === 90) return "hsl(5 65% 58%)"
	if (ang === 120) return "hsl(140 50% 55%)"
	return "hsl(280 50% 62%)"
}

// Orthographic solar system. Distances are compressed with a power curve or
// Mercury would be a single pixel next to Pluto.
function astroCompress(r) { return Math.pow(r, 0.42) }

function astroProject(p, cx, cy, scale) {
	var az = astroAzimuth * DEG, el = astroElevation * DEG
	var r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
	var k = (r === 0) ? 0 : astroCompress(r) / r
	var x = p.x * k, y = p.y * k, z = p.z * k
	var x1 = x * Math.cos(az) - y * Math.sin(az)
	var y1 = x * Math.sin(az) + y * Math.cos(az)
	var y2 = y1 * Math.cos(el) - z * Math.sin(el)
	var depth = y1 * Math.sin(el) + z * Math.cos(el)
	return { x: cx + x1 * scale, y: cy - y2 * scale, depth: depth }
}

function drawAstroChart3D(c, w, h, chart) {
	c.save()
	c.beginPath(); c.rect(0, 0, w, h); c.clip()
	var cx = w / 2, cy = h / 2
	var d = chart.d
	var scale = astroZoom * (Math.min(w, h) / 2 - 26) / astroCompress(41) // Pluto's orbit frames zoom 1

	// starfield backdrop, deterministic so it does not shimmer on redraw
	var seed = 7
	function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
	c.fillStyle = "rgba(255,255,255,0.30)"
	for (var st = 0; st < 90; st++) {
		var sx = rnd() * w, sy = rnd() * h, sr = rnd() * 1.1 + 0.2
		c.beginPath(); c.arc(sx, sy, sr, 0, Math.PI * 2); c.fill()
	}

	var faint = astroCssVar("--border-dark-accent", "#3a3a3a")
	var dim = astroCssVar("--font-white-3", "#999")

	// orbits
	for (var i = 0; i < astroOrbitBodies.length; i++) {
		var path = astroOrbitPath(astroOrbitBodies[i], d, 96)
		c.strokeStyle = faint
		c.globalAlpha = 0.75
		c.beginPath()
		for (var j = 0; j < path.length; j++) {
			var pp = astroProject(path[j], cx, cy, scale)
			if (j === 0) c.moveTo(pp.x, pp.y); else c.lineTo(pp.x, pp.y)
		}
		c.stroke()
	}
	c.globalAlpha = 1

	// Sun
	var sunP = astroProject({ x: 0, y: 0, z: 0 }, cx, cy, scale)
	var grad = c.createRadialGradient(sunP.x, sunP.y, 0, sunP.x, sunP.y, 11)
	grad.addColorStop(0, "hsla(50, 100%, 78%, 0.95)")
	grad.addColorStop(1, "hsla(45, 100%, 55%, 0)")
	c.fillStyle = grad
	c.beginPath(); c.arc(sunP.x, sunP.y, 11, 0, Math.PI * 2); c.fill()
	c.fillStyle = "hsl(48 100% 70%)"
	c.beginPath(); c.arc(sunP.x, sunP.y, 4, 0, Math.PI * 2); c.fill()

	// planets, painted back to front so nearer bodies sit on top
	var items = []
	for (var b = 0; b < astroOrbitBodies.length; b++) {
		var key = astroOrbitBodies[b]
		var pos = astroHelioPos(key, d)
		var pr = astroProject(pos, cx, cy, scale)
		var label = (key === "earth") ? "Earth" : key.charAt(0).toUpperCase() + key.slice(1)
		var glyph = (key === "earth") ? "⊕" : (astroBodies.filter(function (x) { return x.key === key })[0] || { glyph: "•" }).glyph
		items.push({ p: pr, label: label, glyph: glyph, key: key, pos: pos })
	}
	// Moon, offset from Earth and exaggerated so it is visible at all
	var earthPos = astroHelioPos("earth", d)
	var moonGeo = astroLongitude("moon", d)
	var moonPos = { x: earthPos.x + 0.16 * aCos(moonGeo), y: earthPos.y + 0.16 * aSin(moonGeo), z: 0 }
	items.push({ p: astroProject(moonPos, cx, cy, scale), label: "Moon", glyph: "☽", key: "moon", pos: moonPos })

	items.sort(function (a, b2) { return a.p.depth - b2.p.depth })

	for (var n = 0; n < items.length; n++) {
		var it = items[n]
		c.fillStyle = astroPlanetColor(it.key)
		c.beginPath(); c.arc(it.p.x, it.p.y, it.key === "moon" ? 2.2 : 3.4, 0, Math.PI * 2); c.fill()
		c.fillStyle = dim
		c.font = "11px sans-serif"
		c.textAlign = "left"; c.textBaseline = "middle"
		c.fillText(it.glyph + " " + it.label, it.p.x + 7, it.p.y)
	}

	// ecliptic north indicator
	c.fillStyle = dim
	c.font = "10px sans-serif"; c.textAlign = "left"
	c.fillText("Heliocentric · distances compressed", 8, h - 8)
	c.restore()
}

function astroPlanetColor(key) {
	switch (key) {
		case "mercury": return "hsl(30 20% 72%)"
		case "venus":   return "hsl(45 65% 74%)"
		case "earth":   return "hsl(205 70% 66%)"
		case "moon":    return "hsl(0 0% 80%)"
		case "mars":    return "hsl(12 65% 60%)"
		case "jupiter": return "hsl(28 45% 66%)"
		case "saturn":  return "hsl(48 40% 70%)"
		case "uranus":  return "hsl(180 45% 68%)"
		case "neptune": return "hsl(220 60% 66%)"
		case "pluto":   return "hsl(20 20% 62%)"
	}
	return "#ccc"
}

// drag to orbit the 3D camera
$(document).ready(function () {
	$("body").on("mousedown", "#astroCanvas", function (e) {
		if (astroViewMode !== "3d") return
		astroDragging = true; astroDragX = e.pageX; astroDragY = e.pageY
		e.preventDefault()
	})
	$(document).on("mousemove", function (e) {
		if (!astroDragging) return
		astroAzimuth += (e.pageX - astroDragX) * 0.5
		astroElevation = Math.max(2, Math.min(90, astroElevation + (e.pageY - astroDragY) * 0.4))
		astroDragX = e.pageX; astroDragY = e.pageY
		drawAstroVisual()
	})
	$(document).on("mouseup", function () { astroDragging = false })
})

// send a planet or sign name into the phrase box so it runs through the ciphers
function astroSendToPhraseBox(txt) {
	var box = document.getElementById("phraseBox")
	if (box === null) return
	box.value = txt
	updateEnabledCipherTable()
	updateWordBreakdown(breakCipher, false, false)
	box.focus()
}

function astroPad(n) { return (n < 10 ? "0" : "") + n }

var astroUseLocation = false // birth-chart mode
var astroHouseSystem = "whole"

// Panel inputs are remembered across open/close, otherwise reopening the tab
// would silently wipe a birth chart the user had typed in.
var astroInput = null

function astroDefaultInput() {
	var n = new Date()
	return {
		y: n.getUTCFullYear(), m: n.getUTCMonth() + 1, d: n.getUTCDate(),
		hh: n.getUTCHours(), mm: n.getUTCMinutes(),
		lat: 51.5074, lon: -0.1278, tz: 0
	}
}

// pull current field values into astroInput so a rebuild can restore them
function astroCaptureInputs() {
	var v = astroReadInputs()
	astroInput = v
	return v
}

function astroReadInputs() {
	var g = function (id, fb) {
		var el = document.getElementById(id)
		if (el === null || el.value === "") return fb
		var v = Number(el.value)
		return isNaN(v) ? fb : v
	}
	var fb = astroInput || astroDefaultInput()
	return {
		y: g("astroY", fb.y),
		m: g("astroM", fb.m),
		d: g("astroD", fb.d),
		hh: g("astroHH", fb.hh),
		mm: g("astroMM", fb.mm),
		lat: g("astroLat", fb.lat),
		lon: g("astroLon", fb.lon),
		tz: g("astroTZ", fb.tz)
	}
}

// ---- birthplace lookup ------------------------------------------------
//
// Typing an address is far friendlier than hunting for coordinates. Google's
// Geocoding API needs an API key and a billing account, so the default
// provider here is OpenStreetMap's Nominatim, which needs neither. Drop a key
// into astroGoogleKey to switch over; the rest of the flow is identical.

var astroGoogleKey = "" // set this to use Google Geocoding instead of OpenStreetMap
var astroGeoBusy = false

function astroGeoUrl(q) {
	if (astroGoogleKey) {
		return "https://maps.googleapis.com/maps/api/geocode/json?address=" +
			encodeURIComponent(q) + "&key=" + encodeURIComponent(astroGoogleKey)
	}
	return "https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=0&q=" +
		encodeURIComponent(q)
}

function astroGeoParse(data) {
	if (astroGoogleKey) {
		if (!data || !data.results) return []
		return data.results.map(function (r) {
			return { label: r.formatted_address, lat: r.geometry.location.lat, lon: r.geometry.location.lng }
		})
	}
	if (!Array.isArray(data)) return []
	return data.map(function (r) {
		return { label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }
	})
}

function astroGeoSearch() {
	var box = document.getElementById("astroPlace")
	var out = document.getElementById("astroGeoResults")
	if (box === null || out === null) return
	var q = box.value.trim()
	if (q === "") { out.innerHTML = ""; return }
	if (astroGeoBusy) return

	astroGeoBusy = true
	out.innerHTML = '<div class="astroGeoNote">Searching…</div>'

	fetch(astroGeoUrl(q), { headers: { "Accept": "application/json" } })
		.then(function (r) { return r.json() })
		.then(function (data) {
			astroGeoBusy = false
			var hits = astroGeoParse(data)
			if (hits.length === 0) {
				out.innerHTML = '<div class="astroGeoNote">No match. Try adding a country, or enter coordinates below.</div>'
				return
			}
			var o = '<div class="astroGeoList">'
			for (var i = 0; i < hits.length; i++) {
				var hEsc = hits[i].label.replace(/"/g, "&quot;").replace(/'/g, "&#39;")
				o += '<div class="astroGeoHit" onclick="astroPickPlace('+hits[i].lat+','+hits[i].lon+',&quot;'+hEsc+'&quot;)">'
				o += hEsc + '<span class="astroGeoCoords">' + hits[i].lat.toFixed(4) + ', ' + hits[i].lon.toFixed(4) + '</span>'
				o += '</div>'
			}
			o += '</div>'
			if (!astroGoogleKey) o += '<div class="astroGeoNote">Search by OpenStreetMap / Nominatim</div>'
			out.innerHTML = o
		})
		.catch(function () {
			astroGeoBusy = false
			out.innerHTML = '<div class="astroGeoNote astroWarn">Lookup failed. Check your connection, or enter coordinates below.</div>'
		})
}

function astroPickPlace(lat, lon, label) {
	document.getElementById("astroLat").value = lat.toFixed(4)
	document.getElementById("astroLon").value = lon.toFixed(4)

	// Longitude gives the solar time offset; it is only a starting guess because
	// the real offset depends on the country's zone and whether daylight saving
	// was in force on that date. The user is told to confirm it.
	var guess = Math.round(lon / 15)
	document.getElementById("astroTZ").value = guess

	var out = document.getElementById("astroGeoResults")
	if (out !== null) {
		out.innerHTML = '<div class="astroGeoNote">Using <b>' + label + '</b>. ' +
			'UTC offset guessed as <b>' + (guess >= 0 ? "+" : "") + guess + '</b> from longitude &mdash; ' +
			'check it against the time zone and daylight saving in force on that date.</div>'
	}
	updateAstroChart()
}

function astroToggleLocation() {
	astroUseLocation = !astroUseLocation
	$("#astroLocFields").toggleClass("hideValue", !astroUseLocation)
	updateAstroChart()
}

function astroSetHouseSystem(sys) {
	astroHouseSystem = sys
	$(".astroHouseBtn").removeClass("astroViewOn")
	$(sys === "whole" ? "#astroHouseWhole" : "#astroHouseEqual").addClass("astroViewOn")
	updateAstroChart()
}

function astroSetNow() {
	var n = new Date()
	document.getElementById("astroY").value = n.getUTCFullYear()
	document.getElementById("astroM").value = n.getUTCMonth() + 1
	document.getElementById("astroD").value = n.getUTCDate()
	document.getElementById("astroHH").value = n.getUTCHours()
	document.getElementById("astroMM").value = n.getUTCMinutes()
	updateAstroChart()
}

function updateAstroChart() {
	var spot = document.getElementById("astroResults")
	if (spot === null) return

	var v = astroCaptureInputs()
	// with a location the entered time is local, so shift it back to UT
	var ut = v.hh + v.mm / 60 - (astroUseLocation ? v.tz : 0)
	var loc = astroUseLocation ? { lat: v.lat, lon: v.lon, system: astroHouseSystem } : null
	var chart = astroChart(v.y, v.m, v.d, ut, loc)
	astroLastChart = chart // the visualiser draws from this

	var o = ""

	// angles
	if (chart.houses) {
		o += '<table class="astroTable astroAngles"><tbody>'
		o += '<tr class="astroHeadRow"><td>Angle</td><td>Position</td><td>Sign</td></tr>'
		o += '<tr><td class="astroBody" onclick="astroSendToPhraseBox(&quot;Ascendant&quot;)">Ascendant</td>'
		o += '<td class="astroDeg">'+astroPad(chart.ascSign.deg)+'&deg; '+astroPad(chart.ascSign.min)+"'"+'</td>'
		o += '<td class="astroSign" style="color: '+astroSignColor(chart.ascSign.idx)+';" onclick="astroSendToPhraseBox(&quot;'+chart.ascSign.sign.name+'&quot;)"><span class="astroGlyph">'+chart.ascSign.sign.glyph+'</span>'+chart.ascSign.sign.name+'</td></tr>'
		o += '<tr><td class="astroBody" onclick="astroSendToPhraseBox(&quot;Midheaven&quot;)">Midheaven</td>'
		o += '<td class="astroDeg">'+astroPad(chart.mcSign.deg)+'&deg; '+astroPad(chart.mcSign.min)+"'"+'</td>'
		o += '<td class="astroSign" style="color: '+astroSignColor(chart.mcSign.idx)+';" onclick="astroSendToPhraseBox(&quot;'+chart.mcSign.sign.name+'&quot;)"><span class="astroGlyph">'+chart.mcSign.sign.glyph+'</span>'+chart.mcSign.sign.name+'</td></tr>'
		o += '</tbody></table>'
	}

	// positions
	o += '<table class="astroTable"><tbody>'
	o += '<tr class="astroHeadRow"><td>Body</td><td>Position</td><td>Sign</td>'
	o += (chart.houses ? '<td>House</td>' : '<td>Element</td>')+'<td>Motion</td></tr>'
	for (var i = 0; i < chart.bodies.length; i++) {
		var b = chart.bodies[i]
		var col = astroSignColor(b.signIdx)
		o += '<tr>'
		o += '<td class="astroBody" onclick="astroSendToPhraseBox(&quot;'+b.name+'&quot;)" title="Send &quot;'+b.name+'&quot; to the phrase box">'
		o += '<span class="astroGlyph">'+b.glyph+'</span>'+b.name+'</td>'
		o += '<td class="astroDeg">'+astroPad(b.deg)+'&deg; '+astroPad(b.min)+"'"+'</td>'
		o += '<td class="astroSign" style="color: '+col+';" onclick="astroSendToPhraseBox(&quot;'+b.sign.name+'&quot;)" title="Send &quot;'+b.sign.name+'&quot; to the phrase box">'
		o += '<span class="astroGlyph">'+b.sign.glyph+'</span>'+b.sign.name+'</td>'
		o += '<td class="astroEl">'+(chart.houses ? b.house : b.sign.el)+'</td>'
		o += '<td class="astroMotion">'+(b.retro ? '<span class="astroRetro">Rx</span>' : '&mdash;')+'</td>'
		o += '</tr>'
	}
	o += '</tbody></table>'

	// moon phase
	o += '<div class="astroPhase">'
	o += '<span class="astroPhaseName" onclick="astroSendToPhraseBox(&quot;'+chart.phase.name+'&quot;)">'+chart.phase.name+'</span>'
	o += '<span class="astroPhaseNum">'+(chart.phase.illum * 100).toFixed(1)+'% illuminated</span>'
	// an exact new moon lands on 359.99..., which would print as "360.00"
	var elongDisp = (chart.phase.elong >= 359.995) ? 0 : chart.phase.elong
	o += '<span class="astroPhaseNum">'+elongDisp.toFixed(2)+'&deg; from Sun</span>'
	o += '</div>'

	// aspects
	o += '<div class="astroStep">Aspects</div>'
	if (chart.aspects.length === 0) {
		o += '<div class="astroNote">No aspects within orb at this moment.</div>'
	} else {
		o += '<table class="astroTable"><tbody>'
		o += '<tr class="astroHeadRow"><td>Between</td><td>Aspect</td><td>Orb</td></tr>'
		for (var k = 0; k < chart.aspects.length; k++) {
			var asp = chart.aspects[k]
			o += '<tr'+(asp.exact ? ' class="astroExact"' : '')+'>'
			o += '<td class="astroBody">'+asp.a.glyph+' '+asp.a.name+' &nbsp;'+asp.b.glyph+' '+asp.b.name+'</td>'
			o += '<td class="astroAspName" onclick="astroSendToPhraseBox(&quot;'+asp.aspect.name+'&quot;)" title="Send &quot;'+asp.aspect.name+'&quot; to the phrase box">'
			o += '<span class="astroGlyph">'+asp.aspect.glyph+'</span>'+asp.aspect.name+'</td>'
			o += '<td class="astroDeg">'+asp.orb.toFixed(2)+'&deg;</td>'
			o += '</tr>'
		}
		o += '</tbody></table>'
	}

	if (chart.plutoOutOfRange) {
		o += '<div class="astroNote astroWarn">Pluto’s series is only accurate between 1800 and 2100; its position above is unreliable for this date.</div>'
	}

	spot.innerHTML = o
	drawAstroVisual() // keep the wheel/solar view in step with the tables
}

// tint each sign by element so the table scans quickly
function astroSignColor(idx) {
	var el = astroSigns[idx].el
	if (el === "Fire") return "hsl(10 70% 66%)"
	if (el === "Earth") return "hsl(95 45% 60%)"
	if (el === "Air") return "hsl(50 75% 66%)"
	return "hsl(205 70% 68%)" // Water
}

function toggleAstroMenu() {
	if (!astroMenuOpened) {
		closeAllOpenedMenus()
		astroMenuOpened = true

		var n = astroInput || astroDefaultInput()
		var o = '<div class="colorControlsBG astroBG">'
		o += '<input class="closeMenuBtn" type="button" value="&#215;" onclick="closeAllOpenedMenus()">'

		o += '<div class="astroIntro">Geocentric positions for any moment. Click any planet, sign or aspect name to send it to the phrase box and run it through your ciphers.</div>'

		o += '<div class="astroStep">Date &amp; time<span class="astroStepNote">UTC unless a birth place is set below</span></div>'
		o += '<table class="astroInputTable"><tbody><tr>'
		o += '<td><span class="colLabelSmall">Year</span><input type="number" id="astroY" class="astroInput" value="'+n.y+'" oninput="updateAstroChart()"></td>'
		o += '<td><span class="colLabelSmall">Month</span><input type="number" min="1" max="12" id="astroM" class="astroInput" value="'+n.m+'" oninput="updateAstroChart()"></td>'
		o += '<td><span class="colLabelSmall">Day</span><input type="number" min="1" max="31" id="astroD" class="astroInput" value="'+n.d+'" oninput="updateAstroChart()"></td>'
		o += '<td><span class="colLabelSmall">Hour</span><input type="number" min="0" max="23" id="astroHH" class="astroInput" value="'+n.hh+'" oninput="updateAstroChart()"></td>'
		o += '<td><span class="colLabelSmall">Min</span><input type="number" min="0" max="59" id="astroMM" class="astroInput" value="'+n.mm+'" oninput="updateAstroChart()"></td>'
		o += '<td><input class="intBtn3" type="button" value="Now" style="width: auto; margin-left: 0.6em;" onclick="astroSetNow()"></td>'
		o += '</tr></tbody></table>'

		o += '<div class="astroStep">Birth place<span class="astroStepNote">optional &mdash; adds Ascendant, Midheaven and houses</span></div>'
		o += '<div class="optionElement"><label class="chkLabel ciphCheckboxLabel2">Use a birth location<input type="checkbox" id="chkbox_astroLoc" onclick="astroToggleLocation()"'+(astroUseLocation ? ' checked' : '')+'><span class="custChkBox"></span></label></div>'
		o += '<div id="astroLocFields"'+(astroUseLocation ? '' : ' class="hideValue"')+'>'
		o += '<table class="astroInputTable"><tbody><tr>'
		o += '<td><span class="colLabelSmall">Birthplace</span>'
		o += '<input type="text" id="astroPlace" class="astroInput astroPlaceInput" placeholder="e.g. Brooklyn, New York" '
		o += 'onkeydown="if(event.keyCode===13){event.preventDefault();astroGeoSearch();}"></td>'
		o += '<td><input class="intBtn3" type="button" value="Find" style="width: auto;" onclick="astroGeoSearch()"></td>'
		o += '</tr></tbody></table>'
		o += '<div id="astroGeoResults"></div>'
		o += '<table class="astroInputTable"><tbody><tr>'
		o += '<td><span class="colLabelSmall">Latitude</span><input type="number" step="0.0001" id="astroLat" class="astroInput" value='+n.lat+' oninput="updateAstroChart()" title="Degrees north, negative for south"></td>'
		o += '<td><span class="colLabelSmall">Longitude</span><input type="number" step="0.0001" id="astroLon" class="astroInput" value='+n.lon+' oninput="updateAstroChart()" title="Degrees east, negative for west"></td>'
		o += '<td><span class="colLabelSmall">UTC offset</span><input type="number" step="0.25" id="astroTZ" class="astroInput" value='+n.tz+' oninput="updateAstroChart()" title="Hours ahead of UTC at the birth time, e.g. -5 for New York in winter"></td>'
		o += '</tr></tbody></table>'
		o += '<div class="astroSubNote">With a location set, the time above is read as <b>local</b> time at that place.</div>'
		o += '<table class="astroInputTable"><tbody><tr>'
		o += '<td><span class="colLabelSmall">Houses</span></td>'
		o += '<td><input id="astroHouseWhole" class="intBtn3 astroHouseBtn'+(astroHouseSystem === "whole" ? " astroViewOn" : "")+'" type="button" value="Whole Sign" onclick="astroSetHouseSystem(&quot;whole&quot;)"></td>'
		o += '<td><input id="astroHouseEqual" class="intBtn3 astroHouseBtn'+(astroHouseSystem === "equal" ? " astroViewOn" : "")+'" type="button" value="Equal" onclick="astroSetHouseSystem(&quot;equal&quot;)"></td>'
		o += '</tr></tbody></table>'
		o += '</div>'

		o += '<div class="astroStep">Chart'
		o += '<span class="astroViewToggle">'
		o += '<input id="astroView2D" class="intBtn3 astroViewBtn'+(astroViewMode === "2d" ? " astroViewOn" : "")+'" type="button" value="2D" onclick="astroSetView(&quot;2d&quot;)">'
		o += '<input id="astroView3D" class="intBtn3 astroViewBtn'+(astroViewMode === "3d" ? " astroViewOn" : "")+'" type="button" value="3D" onclick="astroSetView(&quot;3d&quot;)">'
		o += '</span></div>'
		o += '<div class="astroCanvasWrap"><canvas id="astroCanvas"></canvas></div>'
		o += '<div id="astroDragHint" class="astroSubNote hideValue">Drag to orbit, scroll to zoom.'
		o += '<span class="astroZoomCtl">'
		o += '<input class="intBtn3 astroZoomBtn" type="button" value="&minus;" onclick="astroZoomBy(1/1.35)">'
		o += '<span id="astroZoomLabel">1.00x</span>'
		o += '<input class="intBtn3 astroZoomBtn" type="button" value="+" onclick="astroZoomBy(1.35)">'
		o += '<input class="intBtn3 astroZoomBtn astroZoomReset" type="button" value="Reset" onclick="astroResetView()">'
		o += '</span></div>'

		o += '<div class="astroStep">Positions</div>'
		o += '<div id="astroResults"></div>'

		o += '</div>'

		document.getElementById("astroMenuArea").innerHTML = o
		updateAstroChart()
		astroBindCanvasWheel()
		astroSetView(astroViewMode) // keep buttons, hint and canvas consistent
	} else {
		document.getElementById("astroMenuArea").innerHTML = ""
		astroMenuOpened = false
	}
}

// ======================= Where the site lives =======================
//
// Today everything is one origin: https://cyphers.news. This file exists so
// that moving Matching to match.cyphers.news later is a one-line change here
// rather than a hunt through every file for a hard-coded "match.html".
//
// WHY THAT MOVE IS WORTH PREPARING FOR
//
// Matching is the only part of the site that handles birth data and sits
// behind a payment. Everything else is a calculator and a forum. Putting the
// paid, personal-data half on its own origin buys three things:
//
//   * a browser-enforced wall. Same-origin policy means a bug in the free
//     half - an XSS in a chat message, a bad third-party script on the
//     calculator - cannot read the Matching page's DOM or its storage. Right
//     now they are the same origin, so it could.
//   * its own Content-Security-Policy and its own security headers, which a
//     GitHub Pages origin cannot set at all.
//   * a clean cut point if Matching ever needs a real server. It can move
//     without the calculator moving with it.
//
// The cost is that Supabase auth sessions are stored per-origin, so a member
// who signs in on cyphers.news is not signed in on match.cyphers.news. That is
// solvable (cookie-based sessions on a shared parent domain) but it is real
// work, and it is the reason this is prepared for rather than done.
//
// SO: DO NOT MOVE THIS YET. Set MATCH_ORIGIN when the auth question is
// answered. Everything downstream already goes through siteMatchUrl().

// Empty string = same origin as whatever page is running. Set to
// "https://match.cyphers.news" to move Matching without touching anything else.
var MATCH_ORIGIN = ""

// Every origin the site is legitimately served from. Used for the postMessage
// check below, and mirrored in the Edge Functions' SITE_ORIGINS secret, which
// is what stops a Stripe return URL from being pointed anywhere else.
var SITE_ORIGINS = [
	"https://cyphers.news",
	"https://www.cyphers.news",
	"http://localhost:8000"
]

// The URL of a page in the Matching half. Use this instead of writing
// "match.html" in a link.
function siteMatchUrl(path) {
	var p = path || "match.html"
	if (!MATCH_ORIGIN) return p                 // same origin: relative link
	return MATCH_ORIGIN.replace(/\/+$/, "") + "/" + p.replace(/^\/+/, "")
}

// True when the page currently running is part of the Matching half. Lets a
// shared module behave differently on the two origins without knowing which
// hostname it is on.
function siteIsMatchOrigin() {
	if (!MATCH_ORIGIN) return /(^|\/)match\.html$/.test(window.location.pathname)
	return window.location.origin === MATCH_ORIGIN
}

// Is this an origin we serve? Answered from the list rather than by pattern,
// because "does the hostname end in cyphers.news" also says yes to
// evil-cyphers.news and to cyphers.news.attacker.com.
function siteKnownOrigin(origin) {
	return SITE_ORIGINS.indexOf(origin) > -1 ||
	       (!!MATCH_ORIGIN && origin === MATCH_ORIGIN)
}

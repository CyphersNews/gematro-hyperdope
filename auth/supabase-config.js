// ===================== Supabase configuration =====================
//
// Fill these two values in from your Supabase dashboard:
//   Project Settings -> API -> Project URL, and the "anon / public" key.
//
// The anon key is DESIGNED to be public. It identifies the project and carries
// no privileges of its own; what a request may actually read or write is
// decided by the Row Level Security policies in supabase/migrations/. Never put
// the service_role key here, that one bypasses RLS entirely and must only ever
// live on a server.
//
// This site is served as static files, so there is no build step to inject
// environment variables. This file is the single place these values live.

var SUPABASE_URL = "https://cklwpynzpfsodnqvbczl.supabase.co"
var SUPABASE_ANON_KEY = "sb_publishable_7_PpZJAZKxxw8qCYSlQ66Q_MzCUSp4_"

// Where Supabase should send users back to after Discord sign-in or after
// clicking a password-reset link. Derived from wherever the site is served, so
// it works on localhost and on cyphers.news without editing.
function authSiteUrl(path) {
	var base = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, "/")
	return base + (path || "")
}

// true once real values have been filled in, used to show a clear message
// instead of failing with an opaque network error
function authIsConfigured() {
	return SUPABASE_URL.indexOf("YOUR-PROJECT-REF") === -1 &&
	       SUPABASE_ANON_KEY.indexOf("YOUR-PUBLISHABLE") === -1
}

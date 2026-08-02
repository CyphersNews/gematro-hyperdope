// ========================= Authentication =========================
//
// Supabase Auth wrapper for the calculator. Supabase owns everything sensitive:
// it hashes passwords (bcrypt), issues and refreshes the session JWT, holds the
// Discord client secret, sends verification and reset emails, and rate limits
// auth endpoints. Nothing here ever sees or stores a password.
//
// Session storage: supabase-js keeps the JWT in localStorage and refreshes it
// automatically. HttpOnly cookies are not available to a static site, since
// only a server can set them; the protection that actually matters for the data
// is Row Level Security, which is enforced by Postgres regardless of where the
// token is kept. See supabase/migrations/ for those policies.

var authClient = null
var authUser = null       // current auth user, null when signed out
var authProfile = null    // matching row from public.profiles
var authReadyCallbacks = []
var authReady = false

// ---- client -----------------------------------------------------------

function getAuthClient() {
	if (authClient !== null) return authClient
	if (typeof supabase === "undefined" || !authIsConfigured()) return null
	authClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		auth: {
			persistSession: true,      // stay signed in across reloads
			autoRefreshToken: true,    // renew before the JWT expires
			detectSessionInUrl: true   // consume the token in the OAuth/reset redirect
		}
	})
	return authClient
}

// Run fn once the initial session lookup has finished, so pages never flash the
// signed-out state before the stored session is restored.
function onAuthReady(fn) {
	if (authReady) { fn(authUser); return }
	authReadyCallbacks.push(fn)
}

function fireAuthReady() {
	authReady = true
	while (authReadyCallbacks.length) authReadyCallbacks.shift()(authUser)
}

function initAuth() {
	var client = getAuthClient()
	if (client === null) { fireAuthReady(); return }

	client.auth.getSession().then(function (res) {
		var session = res.data ? res.data.session : null
		authUser = session ? session.user : null
		if (authUser) {
			syncProfile().then(fireAuthReady).catch(fireAuthReady)
		} else {
			fireAuthReady()
		}
	}).catch(fireAuthReady)

	// keeps every open tab in step: signing out in one signs out the others
	client.auth.onAuthStateChange(function (event, session) {
		authUser = session ? session.user : null
		if (!authUser) authProfile = null
		if (typeof renderAuthNav === "function") renderAuthNav()
		if (authUser && (event === "SIGNED_IN" || event === "USER_UPDATED")) syncProfile()
	})
}

// ---- validation -------------------------------------------------------
//
// Mirrored server-side by Supabase (email format, password length, duplicate
// accounts). Checking here as well just gives faster, friendlier feedback.

function authValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim())
}

// Returns an array of unmet requirements, empty when the password is strong.
function authPasswordProblems(pw) {
	var out = []
	if (pw.length < 10) out.push("at least 10 characters")
	if (!/[a-z]/.test(pw)) out.push("a lowercase letter")
	if (!/[A-Z]/.test(pw)) out.push("an uppercase letter")
	if (!/[0-9]/.test(pw)) out.push("a number")
	return out
}

function authPasswordStrength(pw) {
	var score = 0
	if (pw.length >= 10) score++
	if (pw.length >= 14) score++
	if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
	if (/[0-9]/.test(pw)) score++
	if (/[^A-Za-z0-9]/.test(pw)) score++
	return Math.min(score, 5)
}

// ---- error messages ---------------------------------------------------
//
// Supabase deliberately returns the same message for a wrong password and an
// unknown email so the endpoint cannot be used to discover which addresses are
// registered. Keeping that behaviour rather than splitting the two apart.

function authFriendlyError(err) {
	if (!err) return "Something went wrong. Please try again."
	var m = (err.message || String(err)).toLowerCase()

	if (m.indexOf("invalid login credentials") > -1) return "That email and password do not match an account."
	if (m.indexOf("email not confirmed") > -1) return "Please confirm your email first. Check your inbox for the verification link."
	if (m.indexOf("user already registered") > -1 || m.indexOf("already been registered") > -1) return "An account with that email already exists. Try signing in instead."
	if (m.indexOf("password should be") > -1) return "That password is too short."
	if (m.indexOf("rate limit") > -1 || m.indexOf("too many requests") > -1) return "Too many attempts. Please wait a minute and try again."
	if (m.indexOf("failed to fetch") > -1 || m.indexOf("networkerror") > -1) return "Could not reach the server. Check your connection."
	if (m.indexOf("token has expired") > -1 || m.indexOf("invalid token") > -1) return "That link has expired. Please request a new one."
	return err.message || "Something went wrong. Please try again."
}

// ---- profile ----------------------------------------------------------

// Reads the caller's profile row. RLS restricts this to their own row, so no
// user id needs to be trusted from the client.
function syncProfile() {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.resolve(null)

	return client.from("profiles").select("*").eq("id", authUser.id).maybeSingle()
		.then(function (res) {
			if (res.error) throw res.error
			authProfile = res.data
			if (typeof renderAuthNav === "function") renderAuthNav()
			return authProfile
		})
}

function updateProfile(fields) {
	var client = getAuthClient()
	if (client === null || authUser === null) return Promise.reject(new Error("Not signed in"))
	// id is not taken from the form; RLS also pins the row to auth.uid()
	return client.from("profiles").update(fields).eq("id", authUser.id).select().single()
		.then(function (res) {
			if (res.error) throw res.error
			authProfile = res.data
			if (typeof renderAuthNav === "function") renderAuthNav()
			return authProfile
		})
}

// Display name preference: chosen username, then Discord name, then the local
// part of the email. Never renders the full address in the nav.
function authDisplayName() {
	if (authProfile && authProfile.username) return authProfile.username
	if (authProfile && authProfile.discord_username) return authProfile.discord_username
	if (authUser && authUser.email) return authUser.email.split("@")[0]
	return "Account"
}

function authAvatarUrl() {
	if (authProfile && authProfile.discord_avatar) return authProfile.discord_avatar
	return null
}

// ---- actions ----------------------------------------------------------

function authSignUp(email, password) {
	var client = getAuthClient()
	if (client === null) return Promise.reject(new Error("Authentication is not configured yet."))
	return client.auth.signUp({
		email: String(email).trim(),
		password: password,
		options: { emailRedirectTo: authSiteUrl("login.html") }
	}).then(function (res) {
		if (res.error) throw res.error
		return res.data
	})
}

function authSignIn(email, password) {
	var client = getAuthClient()
	if (client === null) return Promise.reject(new Error("Authentication is not configured yet."))
	return client.auth.signInWithPassword({
		email: String(email).trim(),
		password: password
	}).then(function (res) {
		if (res.error) throw res.error
		return res.data
	})
}

// Discord sign-in. The client secret lives in Supabase, never in this page:
// the browser is redirected to Discord, Discord returns a code to Supabase, and
// Supabase performs the token exchange server-side.
function authSignInWithDiscord() {
	var client = getAuthClient()
	if (client === null) return Promise.reject(new Error("Authentication is not configured yet."))
	return client.auth.signInWithOAuth({
		provider: "discord",
		options: {
			redirectTo: authSiteUrl("profile.html"),
			scopes: "identify email"
		}
	}).then(function (res) {
		if (res.error) throw res.error
		return res.data
	})
}

// Links Discord to the account that is already signed in, rather than creating
// a second one. Supabase refuses to link an identity that already belongs to a
// different user, which is what makes this safe.
function authLinkDiscord() {
	var client = getAuthClient()
	if (client === null) return Promise.reject(new Error("Authentication is not configured yet."))
	if (!client.auth.linkIdentity) return Promise.reject(new Error("This Supabase version does not support identity linking."))
	return client.auth.linkIdentity({
		provider: "discord",
		options: { redirectTo: authSiteUrl("profile.html") }
	}).then(function (res) {
		if (res.error) throw res.error
		return res.data
	})
}

function authSignOut() {
	var client = getAuthClient()
	if (client === null) return Promise.resolve()
	return client.auth.signOut().then(function () {
		authUser = null
		authProfile = null
	})
}

function authRequestPasswordReset(email) {
	var client = getAuthClient()
	if (client === null) return Promise.reject(new Error("Authentication is not configured yet."))
	return client.auth.resetPasswordForEmail(String(email).trim(), {
		redirectTo: authSiteUrl("reset-password.html")
	}).then(function (res) {
		if (res.error) throw res.error
		return res.data
	})
}

function authUpdatePassword(newPassword) {
	var client = getAuthClient()
	if (client === null) return Promise.reject(new Error("Authentication is not configured yet."))
	return client.auth.updateUser({ password: newPassword }).then(function (res) {
		if (res.error) throw res.error
		return res.data
	})
}

function authResendVerification(email) {
	var client = getAuthClient()
	if (client === null) return Promise.reject(new Error("Authentication is not configured yet."))
	return client.auth.resend({
		type: "signup",
		email: String(email).trim(),
		options: { emailRedirectTo: authSiteUrl("login.html") }
	}).then(function (res) {
		if (res.error) throw res.error
		return res.data
	})
}

// ---- page guarding ----------------------------------------------------
//
// This is a convenience redirect, not a security boundary: anything a signed
// out visitor could reach by editing the URL is still just static markup. The
// real boundary is RLS, which stops the data being readable at all.

function requireAuth(redirectTo) {
	onAuthReady(function (user) {
		if (user === null) {
			window.location.replace((redirectTo || "login.html") + "?next=" + encodeURIComponent(window.location.pathname.split("/").pop()))
		}
	})
}

function redirectIfAuthed(target) {
	onAuthReady(function (user) {
		if (user !== null) window.location.replace(target || "profile.html")
	})
}

// Only ever follow same-origin relative paths out of ?next=, so a crafted link
// cannot bounce a freshly signed-in user to another site.
function authNextTarget(fallback) {
	var next = new URLSearchParams(window.location.search).get("next")
	if (!next) return fallback
	if (/^[a-zA-Z0-9_\-]+\.html$/.test(next)) return next
	return fallback
}

$(document).ready(initAuth)

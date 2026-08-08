## Cyphers
![Cyphers News](res/preview.png)
---
> NOTE: Use a desktop Chromium based browser for best experience


## About The Project

Decode your reality.  Discover hidden synchronicities and encode your own!

Try it live at https://cyphers.news/

The Cyphers, Gematro, Hyperdope Gematria project values these principles:

<ul>
<li>Accessible and relevant word and phrase matching</li>
<li>Favor inclusion of well-defined cyphers useful to the community</li>
<li>Free and open source</li>
</ul>

### Features:
<ul>
<li>AUTOLOADING word database for instant phrase matching</li>
<li>Themes! Set your favorite of 10 calculator skins to load by default</li>
<li>Virtual Keyboard</li>
<li>Configurable image scaling</li>
<li>History table editing</li>
<li>Dynamic highlighter with filtering</li>
<li>Support for characters with diacritical marks</li>
<li>History export/import (CSV format)</li>
<li>Fully customizable cyphers (Unicode)</li>
<li>Color controls</li>
<li>Screenshot tools</li>
<li>Quickstart guide</li>
</ul>


## Getting Started

To learn more about how to use Cyphers see the Quickstart Guide in the app under the About menu.

This repo may be cloned as-is to your **web server** for self-hosting your own fully-featured gematria calulator with integrated database matching.

To add more words or phrases to the matching database append them as new lines to the db.txt.  To autoload a different properly formatted .txt file you can change the reference in the AUTO LOAD DATABASE (DB) section at the bottom of index.html.

> NOTE: You must run this app from a web server for the word matching database to autoload due to the way browsers handle local file security.  Please see [this CORS error article](https://stackoverflow.com/questions/58879729/access-to-xmlhttprequest-at-file-sample-txt-from-origin-null-blocked-by-c) for more information.  A quick way to run db matching offline locally is to open the project folder in VS Code and launch it with the Live Server extension.  

If you do not need the auto loading db feature simply download the repo and open index.html.

If you are not interested in using this tool offline or self-hosting and just want to use the tool with the full word matching experience, navigate the project's [official hosted version](http://www.hyperdope.com/gematria).

### Changing the Theme

There are 10 themes packaged with Hyperdope Gematria: black, blue, green, green alt, red charcoal, teal, white, and old book (normal, bright, and dim).

To enable a theme, uncomment the 'AUTO LOAD THEME' script at the bottom of index.html and change the reference to any of the files in the /theme folder.


## Free and Paid

Everything on Cyphers is free except one feature. That is not a launch price
or a trial — it is the shape of the thing.

### Free forever

| Feature | Where |
| --- | --- |
| The gematria calculator, every cypher, custom cyphers | `index.html` |
| Find Matches, the word database, CSV import and export | Calculator |
| The astrology chart, planets, transits, printing | Membership → Chart |
| Accounts, Discord linking, avatars, display names | `login.html`, `profile.html` |
| History, workspace and preset sync across devices | Membership |
| Saved phrases, submissions, the contributor leaderboard | Membership → Saved, Leaders |
| Friends, friend requests, private chat, blocking, reporting | Membership → Friends |
| The social feed, posting decodes, likes | Membership → Social |
| Public profiles, discovery, privacy controls | Membership → Friends |

Social features stay free. If a feature is about members finding each other,
talking, or sharing what they have worked out, it does not cost money.

### Paid

| Feature | Where |
| --- | --- |
| **Matching** — members ranked by how closely their chart and cyphers line up with yours | `match.html` |

Matching is the only paid feature, and the only one planned to be. It costs
because it is the one that needs other people rather than arithmetic.

Setting up a matching profile — entering birth details, choosing cyphers,
seeing your own signature — is free and open to every signed-in member. The
subscription buys the ranked list of other people.

### Turning the paywall on and off

Two switches, both rows in `public.feature_flags`, both editable from the
admin panel under **Flags**:

| Flag | Effect when on |
| --- | --- |
| `matching_enabled` | Matching exists. Off shows the coming-soon card to everyone, subscribers included. |
| `matching_requires_payment` | An active subscription is required. **Off opens Matching to every signed-in member** — this is the switch for a free beta as a *product decision*. |
| **`matching_force_free`** | **TESTING MODE — currently ON.** Every signed-in member gets Matching *and* the paid reading allowance, with no subscription. A banner says so. Stripe still works. **Turn this off before launch.** |
| `matching_llm_depth` | Reserved for the LLM readings. Nothing reads it yet. |

### Testing mode — Matching is currently free

`matching_force_free` is on. Every signed-in member has full Matching and the
paid LLM allowance without paying, and the page tells them so rather than
letting them assume it is permanent.

**Nothing premium was removed to achieve this.** Stripe checkout, the billing
portal, the webhook, `subscriptions`, `current_period_end`, the route
protection and both other flags are exactly as they were. One boolean was
added to the front of one gate:

```sql
-- before                                    -- after
if flag('matching_requires_payment')         if not public.matching_access(me) then
   and not subscription_active(me)             raise …
   and not is_admin(me) then                 end if;
  raise …
end if;                                      -- matching_access() = force_free
                                             --   OR paywall off OR subscribed OR admin
```

**Why a second flag rather than flipping `matching_requires_payment`?** They say
different things. `matching_requires_payment = false` means *"this is how the
product works right now"*. `matching_force_free = true` means *"this is
temporarily unlocked and must be turned back on"*. Keeping them apart means the
state is legible six weeks from now, and the banner appears only for the second.

**Turning paid mode back on** — one of these, no deploy and no code change:

```sql
update public.feature_flags set enabled = false where key = 'matching_force_free';
```

or Admin panel → **Flags** → toggle *Testing mode — Matching is free* off. Paid
gating returns on the very next call. Then set `matching_force_free: false` in
`auth/flags.js` so the pre-network default matches, and redeploy at leisure —
that file only decides what is drawn, never what can be fetched.

**Why the flag is a database row and not an environment variable.** The gate is
`match_list()`, which runs inside Postgres, and Postgres cannot read a Supabase
Edge Function's environment. An env var could only ever be a *copy* of the
authority, free to drift from it. The row is the authority, and flipping it is
the same one-step change an env var would have been. `auth/flags.js` carries the
deploy-time default for the moment before the network answers.

**What testing mode does *not* bypass.** It opens the paywall and nothing else:

- `matching_enabled` still closes Matching for everyone when off
- `matching_opt_in` still required — nobody is in the pool without consenting
- blocks still apply — a blocked member is still not a match
- suspended accounts still get nothing
- RLS on `user_birth_data` is untouched — nobody reads anyone else's birth data

Free mode is a billing state, not a permission state. Consent and privacy are
not billing.

`auth/flags.js` holds fallback defaults for the moment before the network
answers, and for when it does not answer at all. Editing that file changes
what the page draws; it changes nothing about what the page can fetch, because
`match_list()` reads the same flag rows server-side. The paywall is in the
database, not in the JavaScript.

### GDPR notes

The site is UK-based and the data model is built around that rather than
retrofitted to it.

- **Birth data is owner-only.** `user_birth_data` has no policy that lets one
  member read another's row. What crosses between two people is the derived
  signature — a dozen small integers — and it is only ever reported as
  "you share this", never as a value the other person did not publish.
- **Opting in is separate from entering data.** `matching_opt_in` defaults to
  false and is dated when it is given, so consent can be evidenced.
- **Erasure is one call.** `match_forget()` deletes birth data and cypher
  preferences outright, for the member who wants to stay but wants the data
  gone. Deleting the account takes them too, by cascade.
- **No payment data is stored.** `public.subscriptions` holds a status, a
  period end and the provider's own identifiers. No card number, no last four,
  no billing address — the payment provider is the controller for the
  instrument and stays that way.
- **`authenticated` cannot write `subscriptions` at all.** There is no update
  grant. Only the provider's webhook, running as `service_role`, writes it.

### Payments — Stripe

One product, **Matching Access**, one monthly price. Nothing else on the site
is ever charged for.

| Piece | Where |
| --- | --- |
| Start a subscription | `supabase/functions/create-checkout-session/` → Stripe Checkout |
| Cancel, change card, invoices | `supabase/functions/create-portal-session/` → Stripe Billing Portal |
| Grant and revoke access | `supabase/functions/stripe-webhook/` — the only writer of `subscriptions` |

**No card detail touches this site.** Checkout and the portal are Stripe-hosted
pages on Stripe's domain, under Stripe's PCI scope. What we store is a status,
a renewal date, and two Stripe identifiers.

**Revocation has two independent mechanisms**, which is the point:

1. The webhook, which revokes promptly on cancel, payment failure, or deletion.
2. `current_period_end`, which `subscription_active()` checks on every call.

If the webhook never ran again, every subscription would still lapse at its
period end. A webhook outage costs us *prompt* revocation, never *eventual*
revocation — the failure mode is a member keeping access slightly too long,
never keeping it for ever.

Cancellation is Stripe's portal rather than a button of ours. A cancel flow we
write is one more place a bug could keep charging somebody who asked us to
stop.

`'comped'` remains a first-class status for moderators and complimentary
accounts, set with `admin_set_subscription()` — no card involved.

### The LLM layer — esoteric readings

`supabase/functions/esoteric/` calls Claude and returns two or three paragraphs
of reflective prose. **The API key is an Edge Function secret and never reaches
the browser.**

**The prompt is not a parameter.** The request body carries a prompt *type* and
at most a member id — never prompt text, chart data, or numbers. The three
system prompts are hard-coded in the function. The facts are fetched
server-side under the caller's own token via `esoteric_context()`, which runs
`match_list()` internally and therefore inherits the subscription gate, the
opt-in check, and the block check. A member who could write the prompt could
write past the house rules, and the house rules are the whole of the editorial
control.

| Prompt type | What it does |
| --- | --- |
| `explain_gematria` | What a value means in the tradition — factors, history, what the cypher counts |
| `compatibility_summary` | What two members' *shared symbols* mean. Explicitly **not** whether they are compatible |
| `deeper_reflection` | One angle on the member's own numbers they may not have considered |

**The house rules**, enforced in the system prompt on every call: no prediction
of future events; nothing about health, money, or relationships; no advice on
legal, immigration, or safety matters; no claim that a symbolic reading is
factually true. Educational and reflective, ending on a question rather than a
conclusion.

**Rate limits** are rows in `llm_limits`, counted over the `llm_usage` ledger:

| Tier | Per day | Per hour | Max output |
| --- | ---: | ---: | ---: |
| Free | 3 | 2 | 500 tokens |
| Paid | 60 | 15 | 900 tokens |
| Admin | 200 | 40 | 900 tokens |

Free members get a small non-zero allowance rather than zero — a feature nobody
can try is a feature nobody subscribes for. The limit is enforced in the
database, not in the function: an in-memory counter on a serverless platform
resets on every cold start, so retrying enough would buy a fresh allowance.

The reservation is written **before** the model call. A call that is billed but
never recorded is a call somebody can repeat for free. A provider failure marks
the row `failed`, and failed rows do not count against the allowance.

**The ledger holds no prompt and no response** — who, when, which type, and
token counts. Rows are pruned after 90 days by `llm_prune()`.

**Model: `claude-haiku-4-5`** — $1 / $5 per million tokens, the cheapest in the
current Claude lineup, and comfortably good enough for 150 words of reflective
prose. A larger model would roughly triple the per-reading cost to improve
something nobody would notice at this length. If `compatibility_summary` ever
needs more depth, that one prompt type can move to `claude-sonnet-5` on its own
— the model is a constant at the top of the function.

*(Haiku 4.5 is a previous-generation model: it rejects `output_config.effort`
and uses the older `budget_tokens` thinking form. The function sends neither —
a short reflective paragraph needs no thinking budget.)*


## Contributing

Any contributions you make are **greatly appreciated**.  Please report any issues or bugs.  Errors in the cyphers will be fixed with highest priority.

If you have a suggestion that would improve the tool, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

 
<!-- LICENSE -->
## License

Distributed under the GNU General Public License v2.0. See `LICENSE` for more information.


<!-- CONTACT -->
## Contact

Cyphers News - [@CyphersNews on X](https://x.com/CyphersNews) -
cypherstvuk@gmail.com

Cyphers Project Link: [Cyphers News](https://github.com/CyphersNews/gematro-hyperdope)

Gematro Project Link: [Gematro](https://github.com/gematro)

Hyperdope Official - [@LNHyper on X](https://twitter.com/lnhyper) - hyperdopeofficial@protonmail.com

Hyperdope Project Link: [Hyperdope Gematria](https://github.com/malonehunter/hyperdope-gematria)


<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* Special thanks to @Saun-Virroco, the creator of Gematro, who's first name is Mikhail, on which this calculator is entirely based albeit our alterations.  
* [NetVoid, who preserved the Gematro repo and secured the database](https://github.com/CyphersNews/cyphersnews.github.io)
* [Alektryon, who contributed many cyphers, configurations, and reviews.](https://github.com/Alektryon)
* [Hyperdope, who made the live database an option again after Gematro took his version of that code offline. Furthermore, thank you for starting the project of narrowing down our database.](https://github.com/malonehunter/hyperdope-gematria)
### GDPR readiness

Everything below is implemented, not planned.

| Right | How | Where |
| --- | --- | --- |
| **Consent** (Art. 7) | Opt-in defaults to false, is separate from entering data, and every grant/withdrawal is logged | `consent_events`, `ubd_log_consent()` |
| **Access & portability** (Art. 15, 20) | One JSON document of everything held about the caller | `account_export()` |
| **Erasure** (Art. 17) | Whole account, or birth data alone | `delete_own_account()`, `match_forget()` |
| **Data minimisation** | Matching compares derived integers; raw birth data never crosses between members | `user_birth_data` RLS |
| **Storage limitation** | LLM ledger pruned at 90 days, webhook ledger at 30 | `llm_prune()` |
| **No payment data** | Stripe is the controller for the instrument | `subscriptions` holds status + dates only |

Three things the export deliberately **omits**, each for a reason:

- **Messages other people sent you.** Those are their personal data as much as
  yours; Article 15 does not entitle one member to a transcript of another.
- **Moderation decisions.** Telling somebody which rule their message tripped is
  how the filter gets reverse-engineered — the Art. 15(4) "rights and freedoms
  of others" carve-out.
- **Payment records.** Stripe holds them, under its own retention obligations.

**The one thing we cannot do, and must say so.** Deleting a Cyphers account
removes our copy of the subscription state. It does **not** erase Stripe's
transaction ledger — UK tax and company law require those records to be kept
for six years, and Stripe is their controller. The privacy notice has to say
this in those words. Telling a member their payment history is gone when it is
not is itself a breach.

**Still to do outside the code:** a written privacy notice and a Data
Processing Agreement with each processor (Supabase, Stripe, Anthropic,
OpenStreetMap/Nominatim for the birthplace lookup). Anthropic does not train on
API traffic, but the DPA should be on file before launch. Nominatim receives a
place name typed by the member — worth naming in the notice, because it is the
one third party that sees anything birth-related.

## Architecture

### Can we stay on GitHub Pages + serverless?

**Yes — with one addition.** Put Cloudflare in front of Pages.

The stack is genuinely well suited to this. There is no server-side rendering,
no session state to hold, and every privileged operation already runs either in
Postgres (behind RLS and security-definer functions) or in a Supabase Edge
Function (holding the secrets). Nothing about payments or the LLM changed that:
the browser still holds only the anon key, and every boundary is enforced
somewhere the browser cannot reach. Moving to a Node or Rails backend would add
an operational burden and would not close a single hole this design has.

**The one real gap is HTTP response headers.** GitHub Pages cannot set them, so
the site has no `Content-Security-Policy`, `Strict-Transport-Security`,
`X-Content-Type-Options`, or `X-Frame-Options` header. Every page now carries a
`<meta http-equiv="Content-Security-Policy">` as a partial substitute, and that
covers script, style, connect and form-action — but **`frame-ancestors` is
header-only and cannot be set from a meta tag**, so the site is framable, and a
page with a "Subscribe" button on it is exactly the kind of page clickjacking
targets.

Cloudflare in front of Pages fixes that in an afternoon: real headers,
`frame-ancestors 'none'`, HSTS, and rate limiting on the Edge Function routes.
It is free, it needs no code change, and it is the prerequisite for the
subdomain move below.

**Revisit the backend question when** any of these becomes true: you need
scheduled work beyond what `pg_cron` handles; matching outgrows on-the-fly
scoring and needs a job queue; or you take a payment method Stripe Checkout
does not cover. None of those are near.

### Should Matching live on its own subdomain?

**Eventually yes. Not yet — and the code is now ready either way.**

The case for `match.cyphers.news`:

- **A browser-enforced wall.** Matching is the only half handling birth data
  behind a payment. On a separate origin, same-origin policy means an XSS in a
  chat message or a bad third-party script on the calculator cannot read the
  Matching page's DOM or its storage. Today they are one origin, so it could.
- **Its own CSP**, which can be much tighter than the calculator's — the
  calculator legitimately needs `unsafe-inline` and a geocoding endpoint;
  Matching needs neither.
- **A clean cut point** if Matching ever needs a real server. It moves without
  the calculator moving with it.

The case against doing it this week: **Supabase sessions are stored per-origin**,
so a member signed in on `cyphers.news` would not be signed in on
`match.cyphers.news`. Solving it properly means cookie-based sessions scoped to
the parent domain, plus adding the new origin to Supabase's redirect allow-list.
That is real work, and shipping a paywall and a broken sign-in together is a bad
week.

**What is already in place** so the move is a config change rather than a
refactor:

| Piece | Ready |
| --- | --- |
| `auth/site-config.js` | `MATCH_ORIGIN` — set it and every link follows |
| `siteMatchUrl()` | Every link to Matching already goes through it; no `match.html` literals remain in nav code |
| `siteKnownOrigin()` | Allow-list check that correctly rejects `evil-cyphers.news` and `cyphers.news.attacker.com` |
| Edge Function CORS | Reads `SITE_ORIGINS`, already an allow-list rather than `*` |
| Stripe return URLs | Validated against the same allow-list — no open redirect |

**To make the move**, when the auth question is answered: set `MATCH_ORIGIN` in
`auth/site-config.js`, add the origin to the `SITE_ORIGINS` secret, add it to
Supabase Auth → URL Configuration → Redirect URLs, and point the DNS at the same
Pages site (or a second one serving only `match.html` and `auth/`).

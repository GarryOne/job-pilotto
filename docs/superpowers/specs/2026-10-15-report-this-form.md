# "Report this form": a real person's stuck form arrives as a recording

> ✅ **Verdict:** a person presses **Report this form** on a stuck application, reads what will be sent, and presses **Send**. What arrives is the same
> network record the pool makes (`record.json` + bodies), so the existing loop runs on it: fetch → replay offline → "Needs a fix" → `fix-recorded-sites`.
> **Privacy-sensitive: nothing is built until the owner approves this spec.**
> - Nothing is recorded before the press, nothing leaves before **Send**; Cancel is the default.
> - Never sent: typed values, cookies, request headers, request bodies, images, anything from a page with a password field.
> - Sent encrypted with the public key the pool already uses; the site can store it but cannot read it.

**Why:** real fills reach the site as counts only (`/admin/form-filling`: cause, platform, release; hashed hosts). A cause grows, but there is no page to
reproduce it. **Owner request:** "design and build this" (14 Oct 2026, via job-pilotto-cc).

## History (read 15 Oct 2026)
- `net-record.mjs` (14 Oct, 5 commits: settle, prefetched code, non-ASCII redirects, reply-before-failure): the keep rules are stable and pinned by `net-record.test.mjs`. They are Playwright-side (`context.on('request')`).
- `records-publish.mjs` (14 Oct): bundles added beside others, encrypted AES key wrapped by `net-record.pub.pem`; the private key is only in the owner's Keychain (`job-pilotto.capture.key`) and the `NET_RECORD_KEY` secret.
- `/api/install-token` (recipes.js): per-purpose install tokens (`recipes`, `index`), minted with a per-address daily limit. `report` is a third purpose, no new mechanism.
- `pool-share.js`: opt-out "Help the pool grow" (counts, fixed words). **This feature does not ride on that switch:** it has its own button, per-form consent and its own off switch.
- `fill-verify.js` already uses `chrome.debugger` (permission granted at install; it shows Chrome's "debugging this browser" bar). Nothing new to ask Chrome for.

## Decisions

### 1. Where the recorder runs: extension collects, app scrubs and asks
| Part | Where | Why |
|---|---|---|
| Collect responses | extension (`chrome.debugger` Network domain, on the one tab, only while recording) | The person's own Chrome has the page; the harness's Playwright recorder does not exist there |
| Keep rules, blanking, scrub | **one shared Node module `desktop/lib/net-keep.js`** (moved out of `net-record.mjs`: `keepRecord`, `imageSize`, `prefetchedCode`, `normUrl`, `recordable`; `net-record.mjs` imports it) | One copy of the keep rules: a pool record and a report cannot drift. Pure move first, guarded by the existing test |
| Consent, preview, encrypt, upload | desktop app (main process) | The app holds the person's profile (needed for the scrub), the Settings, the install id |
- Raw responses stay **in memory** (extension → app over the existing local extension channel); never written to disk raw. Cap 40 MB raw, then recording stops.
- **The page is reloaded when recording starts** (responses already received cannot be read afterwards). The person then repeats the stuck step with the extension working as usual; **Stop and review** ends it (cap 10 min). The recorder presses nothing.
- The recorder never reads `postData`: request bodies are not touched, so `bodyKey` is `''` for reports (replay then matches by path and order, the `order` rule). No hash of a typed value exists anywhere.
- The debugger session is shared with `fill-verify.js` (one debugger at a time): the recorder owns the attach while recording and passes the turn.

### 2. What leaves the machine, exactly
| Kind | Sent? | How it is removed / why it is safe |
|---|---|---|
| Typed values, request bodies | ❌ never read | not captured (§1) |
| Cookies, `Set-Cookie`, request headers | ❌ | keep rule: only `content-type`, `location`, `access-control-*` |
| Images | ❌ blanked | same-size empty SVG (existing rule); a profile photo never leaves |
| Media | ❌ | dropped (existing rule) |
| Beacons / third-party no-cors | ❌ | dropped (existing rule) |
| Page with a password field (any frame) | ❌ nothing | recording stops: "This page needs you to sign in; it cannot be reported" (never past a login wall) |
| URLs | ✅ scrubbed | host and path kept; **every query value → `<v>`**, fragment dropped; a path segment that is an e-mail or a long id-like token → `<id>`. `Location` headers the same |
| HTML, JSON, text responses | ✅ scrubbed | (a) `value=`, `<textarea>` text and selected options blanked; (b) **the person's own values** (name words, e-mail, phone, place, CV file names, from the app's profile and CV facts: the same list the tripwire builds, through `worker/src/owner-guard.js`'s matcher) replaced by `<name>`, `<email>`...; (c) any e-mail address or phone-like number → `x@example.invalid` / `<phone>` |
| JS, CSS, fonts | ✅ | public site code; (c) still runs, and (b) with the full values only (an e-mail, a phone, two or more name words in a row, a "City, Country"): a single name word that is also an identifier is left in code so a script never breaks. The last gate uses the same rule |
| `record.json` fields | ✅ | entries, hosts, sizes, timings, app version, cause word (fixed list), `source: "person"`; **no free text, no profile, no install id** |
- **Last gate (the tripwire check, before upload):** the scrubbed bundle is scanned again with the owner values; **one hit = nothing is sent**, the person sees "Could not remove everything safely; nothing was sent", only kinds are logged, never values.
- Known limit, said in the preview: a site that keeps the person's data under a label the lists do not know (a nickname) is not matched by (b). Hence the preview, hosts the person can drop, and refusing login pages. Dropping a host removes its responses (the report may then not replay; the preview says so).

### 3. Consent UI
- **Button:** "Report this form" on the Needs-your-attention card of a stuck application (reuse the card's action row) and in ⌘K ("Report this form"). Setting **Settings → Privacy → "Show Report this form"** (default on: the button existing collects nothing).
- **Flow:** press → one sentence ("The page will reload; answers on this page may be cleared. We'll record what the site sends while you repeat the step. Nothing leaves until you press Send.") → **Start recording** (**the reload happens only on this press**; nothing records or reloads before it) → **Stop and review** → preview → **Send** / **Cancel** (Cancel is the focused default, Esc cancels).
- **Preview (readable, not a dump):** hosts with a remove toggle; "N responses, X MB"; "Removed: N typed-value fields, N of your own values, N e-mails/phones, N images, cookies and headers"; a "Show me an example page" toggle (one scrubbed HTML head, so the person sees what a scrubbed page looks like). Built from the common components (skill `ui-look-and-feel`); screenshots in the UI PR.
- After Send: one line "Sent. Delete it any time: Settings → Privacy → Reported forms".

### 4. Transport and storage
- Hybrid encryption in the app, **before it leaves the Mac**: random AES key encrypts the tgz; the key is wrapped with `net-record.pub.pem` (RSA-OAEP), exactly `records-publish.mjs`. The Worker holds **no private key** and cannot read a report.
- `POST /api/report-form` with `Authorization: Bearer <install token, purpose "report">`; body = the two encrypted blobs. No GitHub token on a Mac, no secret in the app.
- Stored in a **new private R2 bucket `form-reports`** (owner step: create it, binding `REPORTS`, **30-day lifecycle rule**); D1 `form_reports` (id, day, install hash, bytes, requests, cause word, status `new|fetched|fixed`). Hosts are **not** in D1 (only in the encrypted bundle): the queue shows counts and cause; hosts appear after the owner decrypts.
- **Retention 30 days.** **Delete on request:** `DELETE /api/report-form/<id>` with the same install token (the install that sent it), plus "Reported forms → Delete" in Settings; the owner can delete any id.
- Never in a repo. The fetched, decrypted copy lives on the owner's Mac like the pool's records; the version published for CI goes into the existing private `net-records` release, never a public place.

### 5. Into the loop
1. `tools/reports-fetch.sh` (owner's Mac, Keychain private key, admin key): lists `new`, downloads, decrypts into the records dir as `reported-<id6>-<registrable domain>/record.json` (`source: "person"`), marks `fetched`. **By hand or on the owner's say, never a schedule.**
2. `newestPerRow` already walks that dir; `npm run row` replays it offline ($0), like any record. A report that does not replay (the site changed, a page that needed a login) is marked "cannot replay" with the replay's reason.
3. `records-publish.mjs` adds it to a new bundle, so the PR replay (`site-replays.yml`) and `/admin/applying` see it.
4. `/admin/applying` shows a **"Reported by a person"** tag on the row (from `source`), with the cause; it goes to **Needs a fix** under the usual rule. `fix-recorded-sites` takes it like any row (record-once's open item 1, "site may have changed", applies: a stale report is closed with that reason).
5. **Telling the person it was fixed: later, optional** (needs the report id kept on their Mac and a one-line status check); not in this build.

### 6. Abuse and cost
| Limit | Value |
|---|---|
| Size per report | 8 MB encrypted (over it: drop fonts, then say "too large", nothing sent) |
| Reports per install per day | 3 (D1 count) |
| Token mints for `report` | 5 per address per day (existing KV counter, 1 write each) |
| Writes per report | 1 R2 put (2 objects), 1 D1 insert, 1 D1 count read, 0 new KV writes |
| Stored | ≤ 3 × 8 MB per install per day, gone after 30 days; R2 free 10 GB |

### 7. Tests
- **Scrub:** a fixture page (document, JSON, script) carrying a fake person's name, e-mail, phone, city and CV file name, plus an input with a `value=`: none of them in the bundle; query values `<v>`; counts in the preview match.
- **Last gate:** a scrub deliberately skipped (stub) → the owner-values scan hits → nothing uploaded.
- **Consent:** no debugger attach, no memory held, no network call without the press; Cancel sends nothing and clears memory; the switch off hides the button and the ⌘K entry (class test over every entry point).
- **Never read:** the collector's source never touches `postData` or cookie fields (a static test, like the existing keep-rules pin); a password-field page ends the recording.
- **Upload:** refused without a token, with a token of another purpose, over the size cap, and over the daily limit; delete works only for the owning install.
- **Replays like a pool record:** a scrubbed report of a fixture form goes through `replay-net` offline and reaches the same first ask as the live fixture.
- Keep rules: `net-record.test.mjs` unchanged and green after the shared-module move.

## Landing order (each its own PR, `report-this-form-<part>` worktrees)
1. Shared keep-rules module `desktop/lib/net-keep.js` (pure move; `net-record.mjs` imports it).
2. Scrub + owner values (shared with the tripwire) + last gate, with the fixture tests.
3. Extension collector + handoff to the app, password-field stop (fixture page, no site).
4. Consent UI, setting, ⌘K entry (before/after images).
5. Worker: token purpose, `POST/DELETE /api/report-form`, R2, D1 migration, limits (owner creates the bucket first).
6. Fetch/decrypt tool, `source: "person"`, the `/admin/applying` tag, one end-to-end test (report → fetch → offline replay).

## Open for the owner
- **Reload on start** (§1) means a mid-journey step needs the person to click through again. The alternative (snapshotting the page's DOM at the press) is not replayable by our replay, so it is not offered. OK?
- **R2 bucket** (§4): a new Cloudflare resource, free tier. OK, or prefer sending straight to a private release?
- **Cause word only, no free-text note** from the person (a note could carry personal text). OK?

## Progress
- [x] History read; design weighed (proof: none: this spec)
- [x] Owner approves the spec and its 3 answers (14 Oct 2026: reload only on the press, with the wording above; R2 bucket `form-reports`, 30 days; cause word only) (proof: #789 merged)
- [x] 1. Shared keep-rules module (#793) (proof: desktop/e2e/test/net-record.test.mjs)
- [x] 2. Scrub, owner values, last gate (proof: desktop/test/report-scrub.test.js)
- [ ] 3. Extension collector and handoff
- [ ] 4. Consent UI, setting, ⌘K
- [ ] 5. Worker upload, storage, limits
- [ ] 6. Fetch tool, "Reported by a person", offline replay

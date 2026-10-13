# Replay by network: the site's own scripts run offline

> ✅ **Verdict: (B) record the network of the live run and replay the site's own scripts from it, as the ONE replayer.**
> The snapshot swaps (states played into the page on a press, an attach or an ask) are deleted; a snapshot stays only as evidence
> of what the extension saw, and as a static body for a document the record lacks.
> It fixes the root of the post-upload miss (17 of 39 CI rows), the re-render/late wipe and the menus the live run typed into.
> The scrollbar (Linux vs Mac) is a separate small PR 0 for any option; real-site pages stay out of CI cases.
>
> Status: **⏸ PARKED (owner, 13 Oct 2026).** See "Parked" below for what brings it back. No build before the owner's yes. Session job-pilotto-replay-design, coordinator job-pilotto-cc.

- **Why:** owner, 13 Oct 2026: "a much deeper/broader solution, or many little steps?" Control runs 1-2 of `npm run measure` failed on the
  page's own state after a CV upload (cause 4, [capture spec](2026-10-13-capture-once-measure-many.md)): 17 of 39 CI rows upload a CV and
  all ask the AI after it, so whole-row numbers are measurable offline on at most 22 rows. Discussion #615: "no small fix known".
- **The one root:** the replay plays DOM snapshots with every script removed. An application page is a program: after the extension acts, the
  site's script changes it. Today the replay imitates those changes; B lets the site's script make them.

## History (read 13 Oct 2026)

| What | Commits | Shows |
|---|---|---|
| Page capture: structure only, scripts dropped, values cut | ad4617a (10 Oct), e68d362 (11 Oct) | `snapshotInPage` removes every `<script>` |
| CSS as a HAR (`cssRecorder`) | e68d362 | the only network record so far; cross-origin sheets only |
| Row replay: snapshots served, later states swapped in on a press / attach / ask | 2e9fa3f, 78e3fcd, fda1b5a, dea0942, b01bdcb (11 Oct) | the site's reactions are **imitated** |
| Fidelity rules added one by one | `followDelayMs` (live gap after an attach), `bindToEvents` (a state bound to the nearest event within 5 s), `swapInPage` morph (keep elements, values by `data-jp-state`), popup binding, recorded settings (#617) | each new site timing needed a new rule; cause 4 stayed |
| Recorded pages (`page-replay`, 95 cases) | b65dabd, df62330 | hand-written pages **with their scripts** and real vendored widgets (React, react-dropzone, flatpickr, intl-tel-input) already run offline |
| Control runs 1-2 | 01f31cc, 5836747 | Personio 3 of 4 asks hit; the miss is the account judgment after the upload |

## The three options

- **A. Per-action DOM snapshots** ("design A"): keep today's replay; capture a snapshot after each extension action (type, attach, press) and swap it in.
- **B. Network record + the site's own scripts:** keep every response the live run's browser got; the replay serves them back and the page's
  own scripts run, as in Chrome's Web Page Replay or Playwright's `routeFromHAR`.
- **C. Mix:** B, with today's snapshot swaps as a fallback for what B cannot serve.

| Limit | A: per-action snapshots | B: network + site scripts | C: B + swaps beside |
|---|---|---|---|
| File chip + remove button after a CV upload | 🟡 only if a swap lands before the ask (a timing rule) | ✅ the site draws it from the recorded upload answer | ✅ as B |
| A page that re-draws or wipes a box (Ashby) | 🟡 timed swaps; the morph guesses which node survived | ✅ the site's own timers, at the live wait | ✅ as B |
| Menus that load options as you type | ❌ a picture of an open menu | ✅ the queries the live run typed; ✅ local menus fully; ❌ a new query | ✅/❌ as B |
| A new build acting differently on a seen page (a question shown after "Yes") | ❌ never seen | ✅ when no new server answer is needed | ✅ as B |
| Real-site pages as CI cases | ❌ | ❌ size, third-party code, the extension's own interleaving | ❌ |
| Linux vs Mac width (15 px scrollbar) | ❌ | ❌ | ❌ → **PR 0, for any option** |
| Size per row | +0.5-3 MB | +2-10 MB before dedupe (estimate; P0/P1 measure) | B + A |
| Code | +~100 lines, and one rule per new timing | +~450, −~250 (the swap machinery goes) | B + all of today's |
| Main risk | keeps growing an imitation of each site | matching requests that differ per run; privacy | **two replayers: against the hard rule** |

**Why B, not A:** A imitates the site; every miss so far was a place the imitation was wrong (a 5 s binding window, a morph that kept the wrong
node, a swap too early for the ask). B runs the site, so the same code that drew the chip live draws it offline. **Why not C:** two replayers
side by side, which the hard rules forbid; B's narrow fallback (a static snapshot for a document it lacks) is enough.

## B in detail: the hard parts

### 1. Recording (live run, harness only)
- **One recorder** replaces `cssRecorder` (capture-page.mjs): `context.on('requestfinished' | 'requestfailed')` in the live harness's browser.
- Per request: method, address, resource type, the frame's document, its n-th place among same-key requests, the live start offset and wait,
  a hash of its normalised body (**never the body**), response status, the kept headers (§12), the body by content hash.
- Not Playwright's `recordHar`: it writes cookies, every header and request bodies to disk before any scrub; ours never holds them.
- Never recorded: loopback (the app, the AI) and `chrome-extension://`.

### 2. Matching in the replay (first rule that matches wins)
1. **Exact:** method + address with query + body hash.
2. **Normalised:** the memo's own normaliser (`model-memo.js normalise`: timestamps, uuids, long hex, 6+ digit runs) on query values and body,
   plus a query value of 12+ mixed letters and digits (a nonce, an upload's signature). One normaliser for asks and requests.
3. **By order:** same method + host + path, the n-th request gets the n-th recording (a GET's last repeats; a POST's does not). Counted as **loose**, like the memo's loose hits.
4. **None:** 404 and a counted **"not recorded"** (method, host, path). A first-party document, script, fetch or xhr not recorded makes the row
   **not measured** (the capture spec's safeguard 2, extended); a third-party one is only counted.

First party = a host whose registrable domain (public suffix list) served a document or frame of the journey. Headers and cookies never take part.

### 3. What differs per run
- **Timestamps, nonces, random ids** in addresses and bodies: rule 2; what is left: rule 3.
- **CSRF and session tokens:** served as recorded; sent back in a header (ignored) or a body field (rule 2 or 3).
- **Cookies:** none kept. A cookie a script sets works offline; a server-set one a script reads is missing (P0 checks a page that does).
- **Timing:** each response comes back after its **live wait** (capped 8 s; ×1.6 under `--slow`), so an autofill lands 2.6 s after the upload as it did live. This replaces `followDelayMs`.

### 4. POSTs and the CV upload
- The replay's extension attaches the same fake CV (same bytes). The upload matches by method + path + the file part's hash
  (multipart: other parts normalised; a presigned PUT: by path, its signature normalised).
- Its recorded answer (the site's parse of the **fake** CV, scrubbed) comes back after the live wait; the site's script draws the chip, autofills, re-renders.
- **Kept:** the response. **Never kept:** the request body (file bytes, typed values). An attached file that is not one of the fake applicant's
  fixture files (by hash) → the whole record is refused.
- **Submit** is never pressed live, so never recorded; a replay request that posts the form gets a 404 and a named finding.

### 5. WebSockets and streaming
- Sockets are not recorded (frames can carry session data). In the replay `context.routeWebSocket` closes every socket (a dropped connection) and counts it; a row whose live run opened a first-party socket is flagged.
- Server-sent events and streamed fetches: one whole body, served after its live time.

### 6. Clock and Math.random
- `context.clock.install({time: <the capture's start>})` before the first page: `Date` and timers start at the live run's time and flow
  ("posted 3 days ago", a token's expiry check read as live). P0 checks that time flows after install.
- Main world only: the extension's isolated world keeps the real clock (its code and timing unchanged).
- `Math.random` and `crypto` are not seeded (the live run was not); the ids they make are normalised (rule 2). Replay-to-replay sameness is measured in P0 (5 runs).

### 7. Service workers
- Blocked in both capture and replay (`serviceWorkers: 'block'`: a page-only init script, checked in Playwright 1.63's code; the extension's MV3 worker is untouched).
  Playwright cannot serve a request a site's worker intercepts. Trade-off: the capturing browser runs sites without their worker, as on a person's first visit.

### 8. Bot-check scripts: never a way around them
- The replay is offline: nothing reaches a site; no pass token is made, kept or sent.
- A row whose live run ended at a bot check or a 401/403/429 keeps **no network record** (its ending is the live one; not replayable).
- A check script on an ordinary page runs offline, its calls get 404, it fails closed. No vendor list.
- Recording adds no visit: it records the visit the pool already makes (per-site limit unchanged).

### 9. Third-party trackers
- Not blocked live (the capturing browser stays a person's browser; blocking can break a page).
- At save: third-party responses other than script, style and font are dropped (beacons, pixels, collect calls → 404 offline, counted, never a blocker).
- Third-party scripts are kept (a hosted form's widget from a CDN needs them).

### 10. Images, media, fonts
- An image is kept as a **same-size empty SVG** (its size read from the file header): layout unchanged, no picture kept. Video and audio dropped. Fonts kept (text width is layout).

### 11. Size
- Bodies stored once by content hash (`<captures>/bodies/<sha256>`); a capture lists its entries → hashes. A platform's bundle is stored once across rows and days.
- Cap: 30 MB of new bytes a capture; over it → no network record, flagged "too big".
- Today's captures: 2-4 MB a row, mostly pictures (Lever 3.7 MB, Personio 2.1 MB, 13 Oct). B adds an estimated 2-10 MB a row before dedupe; P0 and P1 measure it.

### 12. Privacy (a public repo; CI artifacts readable by anyone)
- **Never kept:** cookies, request headers, request bodies, `Set-Cookie`, `Authorization`; response headers other than `content-type`,
  `location` and `access-control-*` (a cross-origin call is refused without them).
- **Scrubbed:** HTML, JSON and text bodies by `scrubPage` (emails, phones, the person's own values; JSON: string values only, re-serialised).
- **Byte-exact but checked:** scripts and styles (a phone scrub would break code). A person's value or a non-example email inside one → the record is refused.
- **Beyond today's DOM captures:** the sites' own code and the API answers an anonymous visitor's browser got (third parties' data, e.g. a
  recruiter's name in a job's JSON) and the fake applicant's echoes.
- **No network record ever enters the repo.**

**Owner decision: where CI's network record lives**

| | Option | For | Against |
|---|---|---|---|
| 1 ✅ | **Encrypted inside the CI artifact** (AES-256-GCM; key in a GitHub secret + Keychain `job-pilotto.capture.key`; `captures pull` decrypts) | unreadable to the public; no new store | one new secret |
| 2 | Scrubbed, public, like today's captures | nothing new | publishes sites' code and API answers for 30 days |
| 3 | Mac-only (CI keeps DOM only) | nothing leaves the Mac | the 39 CI rows lose the fix |

## Hard rules
- **ONE replayer.** row-replay's route serves the record; `swapInPage`, `bindToEvents`, `followDelayMs`, `stateAfter`, `laterStates` and the
  state advance on `__jpReplayPressed` / `__jpReplayAttached` are **deleted in the same PR**. Kept: `samePress`, evidence lines, `boxesOf`, the still clock.
  A document the record lacks gets its first snapshot as a static body (no scripts, no swaps); if the live page changed after, the row is not measured.
- `page-replay` (recorded/ fixtures, hand-written with their own scripts) is a fixture server, not a recording replayer: unchanged.
- **The AI memo stays the one place for kept answers.** The record never holds the app's asks (loopback is never recorded).
- **The extension and app code never change:** recorder, routes, clock and worker block live in the harness.
- **Never a way around a site's limits or bot checks** (§8).

## What B still cannot do (said up front)
- A press or a typed query the live run never made that needs the server: **unseen** (the capture spec's safeguard 3).
- A page that needs a live socket, its service worker or a server-set cookie: diverges, counted.
- A prompt change: still not measured (the memo).
- Real-site CI cases: no (size, third-party code, the extension's own concurrent flows). The Linux width: PR 0.

## Success measure: the positive control
- On a CI batch, on the build that captured it: **per row the same asks hit (0 memo misses), the same filled/left and the same ending as the
  live run**, with **≥ 3 rows that upload a CV**, and 0 first-party "not recorded".
- One upload row replayed 5 times and once under `--slow`: identical.
- Then `npm run measure` loses "unverified" (capture spec PR 3).

## Prototype plan: $0 first

**P0: a local fixture site, recorded and replayed (no site visit, no AI, $0, about half a day).** In my scratch folder; no PR.
- Fake hosts: `--host-resolver-rules` maps `jobs.fixture.test` and `cdn.fixture-cdn.test` to a loopback server (the app's loopback stays excluded),
  so the recorder sees "real" hosts. Built on the vendored React + react-dropzone (desktop/e2e/vendor/):
  1. a CV upload (react-dropzone) → POST multipart → the fake applicant's JSON → file chip + remove button, autofill, the name boxes
     re-drawn 2.5 s and 7 s later (the shape of recorded/upload-rerender-clears-typed-1);
  2. a menu whose options load per typed text (`/api/options?q=`): react-select if a pinned browser build exists, else on the vendored React;
  3. requests that differ per run: `/api/session?t=<now>&n=<random>`, a CSRF meta token sent back in a header and a body field, a "presigned" PUT with a random signature;
  4. a third-party script and beacon, a websocket, a service worker registration, a timer-driven text, a cookie set by the server and read by a script.
- Run: record one live run with the real extension and the stub app's fixed answers (`answerFor`, no AI) → replay it three ways:
  today's snapshot replay, the network prototype, the network prototype ×5 and under `--slow`.
- Compare: each ask's normalised body hash (the memo key's input: same hash = the ask would hit), end boxes, presses, the chip at the next ask, the not-recorded counts.
- **Pass:** the network replay matches live on every ask hash and box, 5 of 5 alike; **and** the snapshot replay misses the post-upload ask
  (the test's own positive control: it must fail where we expect it to).

**P1: three real rows (needs the owner, via cc; never dispatched by me).**
- 3 CI rows that upload a CV (Personio from control runs 1-2, and two others), recorded with the network recorder on a branch, replayed offline on that build.
- Cost: ~$0.06 a row in AI (pool measured $0.056) ≈ **$0.17**, and 3 of the per-site daily visits (2 a day a host).
- Measures: real size a row, not-recorded and loose counts, asks hit against control run 2 (3 of 4).

## Prototype results (13 Oct 2026, $0, a fixture site, the real extension)

Fixture: React 18 + react-dropzone 14 (vendored); a CV upload → the site's parse → file chip, autofill, a new question, the name boxes redrawn at +2.5 s and +7 s.

| Run | Chip + new question | Site timeline (+2.5 / +7.0 s) | Requests not recorded | Memo misses |
|---|---|---|---|---|
| Snapshot replay (today) | ❌ | ❌ | | |
| Network replay, stub app (P0, ×5 + slow) | ✅ 6/6 | | 0 | (not measured) |
| Network replay, offline app + memo (P0b, ×3 + no clock + slow) | ✅ 5/5 | ✅ exact 5/5, with or without `clock.install` | 0 (12 exact, 3 normalised) | 6, 8, 6, 8; **2 under --slow** |

- **The page side works:** the site's own script redraws from the record at the live times, every run. Today's replay fails the same fixture (positive control).
- **The rest is pace, not page:** the misses are asks live never made at that moment (repair, closer look, account judgment). Offline, the extension's first pass ended at +13 s vs +48 s live; slowing the replay cut misses 6-8 → 2.
- **Live is not deterministic either:** two live runs of the fixture differed ("Why" filled vs empty; 36 vs 29 asks; a 2nd page-kind ask in one only).
  So "matches live" means: **(a) every ask the live run made hits**, and **(b) the asks a replay adds stay within live-vs-live's own spread**, measured on 2 live runs. Never one merged number.

## Build PRs (after the owner's yes)
- **PR 0:** the scrollbar width recorded at capture and forced in the replay (cause 3). Independent of A/B/C.
- **PR 1:** the network recorder (replaces `cssRecorder`), the body store, scrub and tripwires, the encrypted CI part (decision 1).
- **PR 2:** the replayer: row-replay serves the record; the swap machinery deleted; `measure` counts not-recorded and loose serves.
- **PR 3:** P1's rows and the positive control; lift "unverified".
- Captures made before PR 1 have no record: they replay static and are "not measured" until a live visit refreshes them (the 30-day library turns over).
- Files: job-pilotto-capture owns capture-*, measure* and row-replay.mjs today; PRs 1-2 are agreed with it first (it builds them or hands them over).

## Parked (owner, 13 Oct 2026)
> ⏸ **Parked.** B changes how well a fix is measured offline, not what users get (the fill rate on real sites). The owner chose a bake-off first:
> our extension vs other form-filling agents on 10 live rows. The bake-off does not need replay.

- **Comes back when:** the bake-off says keep investing in our own extension. Then the first step is P1, before any build PR.
- **P1:** 3 real CI rows that upload a CV, recorded live once and replayed offline. About $0.17 of AI ($0.056/row), 3 site visits, about 2-3 h.
  It needs the owner's yes (through cc) and decision 1 (where CI records live).
- **Build B only if, on all 3 rows:**
  - every ask the live run made hits in the replay;
  - extra asks (the replay asked, live did not) stay within the live-vs-live spread, measured on 2 live runs of the same row;
  - the page's own after-upload state (the chip, the questions it reveals) appears 3/3;
  - no first-party request is "not recorded".
- **Drop B if:** any row misses a first-party request or the after-upload state, or extra asks exceed the live spread.
  The likely cause would be pace, not the page: the extension's first pass ended at +13 s offline vs +48 s live in P0b. That gap would then be its own item, not part of B.
- **Not done:** P0c (replay at the app's own pace), PRs 0-3. The prototype is scratch only; nothing of it is in the repo.

## Progress
- [x] History read; options A, B, C compared; B chosen (proof: none: this spec)
- [ ] cc's review
- [ ] The owner's yes, and decision 1 (where CI's record lives)
- [x] P0 + P0b: fixture site recorded and replayed; page side passes, pace open (proof: docs/superpowers/specs/2026-10-13-replay-by-network.md)
- [ ] P0c: replay the app's own route latencies; bar (a) all live asks hit, (b) extra asks within live-vs-live spread
- [ ] P1: three real upload rows (owner's yes for $0.17 and 3 visits)
- [ ] PRs 0-3 landed; "unverified" lifted
- [ ] When the positive control passes: the skills fix-failing-forms and run-applying-smoke-pool say "measure offline first" again (today: "measure is unverified, measure live")

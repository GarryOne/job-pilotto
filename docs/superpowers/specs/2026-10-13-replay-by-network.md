# Replay by network: the site's own scripts run offline

> ✅ **Verdict: (B) record the network of the live run and replay the site's own scripts from it, as the ONE replayer.**
> The snapshot swaps (states played into the page on a press, an attach or an ask) are deleted; a snapshot stays only as evidence
> of what the extension saw, and as a static body for a document the record lacks.
> It fixes the root of the post-upload miss (17 of 39 CI rows), the re-render/late wipe and the menus the live run typed into.
> The scrollbar (Linux vs Mac) is a separate small PR 0 for any option; real-site pages stay out of CI cases.
>
> Status: **✅ PROVEN on real rows (13 Oct 2026, owner: "let's prove it").** 30 of 32 live AI asks matched on 6 pool rows; building day by day (see "Proof result" and "Plan"). Session job-pilotto-replay-design, coordinator job-pilotto-cc.

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
- Only `Date` is shifted to the capture's start and flows on (`lib/replay-date.mjs`, #696); the timers stay real ("posted 3 days ago",
  a token's expiry check read as live). `clock.install` (fake timers) made Databricks show a cookie banner it never showed live; `--fake-timers` keeps it for comparison.
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

## Build PRs (day 2 onward; see Plan)
- **PR 0:** the scrollbar width recorded at capture and forced in the replay (cause 3). Independent of A/B/C.
- **PR 1:** the network recorder (replaces `cssRecorder`), the body store, scrub and tripwires, the encrypted CI part (decision 1).
- **PR 2:** the replayer: row-replay serves the record; the swap machinery deleted; `measure` counts not-recorded and loose serves.
- **PR 3:** P1's rows and the positive control; lift "unverified".
- Captures made before PR 1 have no record: they replay static and are "not measured" until a live visit refreshes them (the 30-day library turns over).
- Files: job-pilotto-capture owns capture-*, measure* and row-replay.mjs today; PRs 1-2 are agreed with it first (it builds them or hands them over).

## Proof result (13 Oct 2026, ~$0.15 of AI, draft #652)
> ✅ **The network replay matches live on real rows.** 30 of 32 live AI asks on 6 pool rows; the old parking test passes. Today's snapshot replay missed the
> after-upload state on every upload row it was tried on.

| Row kind | Live asks | Snapshot replay | Network replay |
|---|---|---|---|
| Form + CV upload (3 rows) | 5, 4, 10 | 1 extra / stopped after 1 / 2 extra | 5/5, 4/4, 10/10 |
| Posting → account step, multi-host (2 rows) | 3, 3 | – | 3/3, 2/3 |
| Posting → embedded form + upload (1 row) | 7 | – | 6/7 (two live runs also differ by 1) |

- Requests to the site missing from the record: 0 on every row. Replies matched by order: 15 of 15 the same as live.
- **General fixes the real rows needed** (all in the replayer, no site names):
  - a route-answered upload fires no `xhr.upload` progress/load/loadend, so the replay fires them;
  - an upload reply echoes the page's time+random key, so the replay swaps in its own;
  - Chromium doesn't follow a route-answered 3xx on a navigation, so it's served as `location.replace`, keeping the #fill mark;
  - Linux CI draws a 15 px scrollbar and a Mac none (cause 3), so the capture records the width and the replay forces it.
- **Not the cause** (measured): the page clock, slower replies (×1.6), a 4× CPU slowdown.
- **Key:** generated with openssl into a 700-mode scratch folder, then the Keychain, then `rm -P`. For the build, generate it straight into the Keychain through a pipe.

## Why a row does not replay as live (found 13-14 Oct 2026; read this first when a row is "off")

Find the first AI ask that missed: replay with `JOB_PILOTTO_MODEL_MEMO_MISSES=<file>` (+ `JP_NET_LOG=<file>` for the network), then compare each missed ask with the
nearest kept one part by part (`memoParts` in `desktop/lib/ai/model-memo.js`): the ONE line that differs names the cause. Compare live and replay `app.log` timelines
(`fill: filling`, `Claude answered`, `fill: fields:`) and the live capture's `pages/*.html` with the replay's.

| Cause | How it shows | Fix / status |
|---|---|---|
| Eligibility stop on in the replay | `fill: did not fill: <not a fit>` on the replay; live had `"forced":"check off"` | #681: the replay runs with the stop as the live run had it (record `eligibility`) |
| Prefetched code dropped as a beacon | Third-party `/…chunk.js` served the dropped entry (404); a widget stays in its default (Starling: phone +1 vs live +41) | #686: a GET whose reply is code is kept; old records need a re-record |
| Replay cut by its time cap | `filled: null`, the watch ended before `fill: fields:`; the replay starts ~25-35 s late and drifts | #686: the cap is the live run's length + 90 s |
| A live recording that ended too early | live `app.log` has no `fill: fields:`; the replay asks form questions the live run never did | Re-record with a longer live window (`SMOKE_SECONDS`) |
| A real regression in the build | Replay on main: `Claude answered` after `first fields filled`, then never `fill: fields:` (Starling, Duolingo live 2/2; the coreweave replay stall was the fake timers, not this) | Not a replay gap. Fixed by job-pilotto-combo-stall (#690) |
| Upload recorded as failed | The storage POST kept as `failed` with no reply (recorder before #670) | #670 + a re-record |
| Fake timers on the replay page | Databricks: the OneTrust banner in the first ask, never live (0/8); coreweave stalls after its answers (8-9/11) | #696: Date only, real timers: as live **on the Mac** (Databricks 8/8, coreweave 11/11 ×2). On the runner the page also needs the live run's time zone: #706 + #709 (the browser's timezoneId) → Databricks 7/8, outcome as live (run 38501390009) |
| A late-loading part of the page | Deloitte: "Others have also looked at" box in or out of the first ask (3/4, then 1/4) | Open (deferred): timing |
| Page details that vary at read time | Datadog: the same DOM, but the product menu's links visible live and hidden in the replay at the first page question; Deloitte: "Your opinion matters" / "Others have also looked at" boxes | Deferred: not a product bug (same page kind, live fills as before); a longer wait would slow every application |
| The macOS runner disagrees with the Mac | Databricks: the OneTrust banner on the runner (UTC) until the replay took the live run's zone (#709; each replay.json says its pageSees zone); coreweave 3/11 with the right zone (open, misses.jsonl #708); Datadog 9/9 on the Mac, stops at the posting on the runner; Recruitee | Open; not a gate risk (a row not faithful on the runner never counts) |

Rule: a row that is not "same as live" is a replay question first; only when the live run and the replay saw the same page and the build alone changed the outcome is it a product regression (and then the replay is the cheapest reproducer).

### Replay-fix log (13-14 Oct 2026): every cause fixed in the mechanism, and the row that shows it
One row per cause, from the replay commits of those two days (`git log --since=2026-10-13 -i --grep=replay`). Before changing `replay-net.mjs`, `live-row.mjs`, `replay-gate.mjs`, `replay-records.mjs` or the recorder
(`lib/net-record.mjs`), find your cause here: a fix that undoes one of these rows needs its proving row replayed first. New cause: add its row in the same PR (cause, fix commit, proving row).
"Not found" = the commit body names no row; fill it when you know. Product fixes found through a replay (#690 combo stall, 615d5b7, cf4b04d, 0ae22fd, 8cb07e8) are not replay-mechanism causes and are not listed.

| Cause (what the replay did that live did not) | Fix commit | Row that proves it |
|---|---|---|
| Eligibility stop left on, so a kept "not a fit" stopped the fill | 5b698ef (#681) | Teamtailor (2 of 6 asks, 7 filled) |
| Prefetched third-party code dropped as a beacon | 9b0b242 (#686) | Starling (phone +1 vs +41) |
| Replay cut by its time cap | 9b0b242 (#686): live length + 90 s | Starling |
| A reply that came before its request failed was dropped (upload shown as failed) | 59d94f2 | Ashby (4 of 5 asks) |
| Upload POST recorded as failed with no reply (recorder before #670) | #670 + re-record | not found |
| Fake timers on the page showed a cookie banner never shown live | 8f1c5aa (#696) | Databricks 0/8 to 8/8; coreweave stall |
| Runner in UTC drew a banner the Zurich live run never drew | 56d14f1 (#706), 2e31f06 (#709), c80998b | Databricks 1/8 to 7/8 on the runner |
| Frame pixel size differs with the runner's fonts | e6ede59 (#713), 7687c2d, b6acd99 | coreweave 3/11 (frame 6869 vs 6993 px), Databricks 1430 vs 1426 |
| Redirect to a non-ASCII address double-encoded | 6e5adb8 | Breitling (0/8, "Genève") |
| Random draws (survey, variant) differ from the live run | c5e89b6 | a job board's survey (row not named in the commit) |
| Watch kept running ~45 s after the extension ended | c1aaf17 | first CI replay run (~93 s a row) |
| Prompt change makes old recordings miss (not a replay bug) | 014a784: "out of date", never red | Swatch, Join, jobup, Deloitte after 997af1f |
| Claude's answers arriving late lost the fill (no check saw it) | 5b39a7b: second replay with answers +4 s | 5afa5a8 (Hadrian) |
| An ask the recording lacks counted red | 29a6a43: waits for a Mac fill (`fill-memo`) | not found |
| Late-loading or read-time page parts change the first ask | none: rows deferred (Deloitte cd5bc38, Datadog 27ed5ae, coreweave 4b7f55f) | Deloitte 3/4 then 1/4; Datadog |
| Gate counted a flaky row (Databricks 8/8 then 1/8) | f44a56d: a deferred row never counts; 2 runs 100% in a row | Databricks |
| Today (14 Oct 22:50): the extension asked 0.55 s after load, not ~8 s | open | Richemont Workday, 7 new records at 0/7 |

Churn seen in the same two days (why this log exists): Databricks was un-deferred (fa7d282), deferred again (c5aa2ec) and removed from the list (c80998b) within 1.5 h; `replay-net.mjs` changed 14 times,
`live-row.mjs` and `replay-gate.mjs` 9 times each. Guard: `replay-deferred.json` rows carry an owner and a re-check date (`test/replay-records.test.mjs`).

## Schedule, gate and alerts (owner, 14 Oct 2026, via cc: "an E2E-like schedule, 4 times a day, once before the nightly beta as a gate"; Telegram on every failure)

```
Worker cron (on time) ── 02:00 Zurich ──► replay-offline.yml on main ──► green on commit X? ──► 04:00 nightly beta builds X
                      └─ 11:47 15:47 19:47 (beside E2E) ──► replay-offline.yml          red / missing ──► no beta (as a red E2E)
GitHub schedule = backup only.  PRs: no run (frees the macOS queue).   every failure of e2e.yml or replay-offline.yml ──► Telegram 🔴; first green after ──► 🟢
```

| Piece | Decision |
|---|---|
| Triggers | `workflow_dispatch` from the Worker (`worker/src/scheduler.js`): the night trigger `0 0,1,2,3 * * *` (the UTC hour that is 02:00 in Zurich starts it, the one that is 04:00 the nightly; a 4th trigger was refused on 14 Oct 2026: 5 per account, all used), and the E2E cron `47 9,13,17` starts it too. GitHub `schedule:` as backup. No `pull_request`, no `push` (supersedes #675). |
| What it measures | Each row's newest recording replayed with main. Per row, the **outcome**: live asks answered, extra asks, furthest step, filled / left. |
| Counted rows | Owner, 14 Oct 2026: "only count/consider the 100% same as live". A row **counts** only when its replay is 100% same as live **on this runner** (every live ask answered, 0 extra, 0 site requests unrecorded) in the baseline run: recordings are made from main, so the first run after a recording is that recording's own build. Every other row shows "not counted: replay not faithful (why)" and can never turn the run red. The run's line: "N of M rows counted · K worse". |
| Worse | A **counted** row whose outcome is below **the baseline**: the last green run (same recordings, same runner), never live. A worse row is replayed once more; if the retry equals the baseline, it is **noise** and never counts. |
| Baseline | A green run becomes the baseline; per-row results are kept with the run (artifact) and on /admin/applying. A red run keeps the old baseline until the row is fixed (a later green run) or the owner accepts it. A new live recording of a row resets that row's baseline (logged). |
| The one human decision | A worse row → Telegram (row, what got worse, run link, the PRs merged since the last green run) → a fixer, or the owner **labels the merged PR `replay-accepted`** and comments `Replay-accept: <reason>` (or `Replay-accept: <row> — <reason>` for one row) (owner, 14 Oct 2026: the label replaced the "Accept" button on /admin). The next nightly reads the label from the PRs merged since the baseline run (`replay-accepts.mjs`): those rows are "accepted", not red, and the green run becomes the baseline. A label without a reason stays red ("add the reason"). No D1 table, no new secret. |
| Three questions | (1) **Worse?** each scheduled run vs the last green run, counted rows only. (2) **Faithful?** once per recording: replayed with the recording's own build (the record keeps its commit), 100% same as live → a "counted" flag stored with the recording. Until that exists, "counted" = same as live in the baseline run. (3) **Values right?** typed values vs the fake applicant's known answers (a repo file): later. |
| PRs | **A:** schedule (Worker cron + backup), compare with retry, nightly gate, Telegram for e2e + replay. **B:** the `replay-accepted` label + reason comment (built; no site button), then the per-recording faithful flag. (3) after B. |
| Red | At least one counted row worse after its retry, or the job broke. "Same as live" over all rows stays the tool's health number on /admin/applying. |
| Gate | `desktop.yml`'s plan (the nightly only) builds **the newest commit of main with a green `replay-offline.yml` run** (normally the 02:00 run's): a merge after 02:00 waits for the next night. The newest run red or missing = no build, the reason in the summary and on Telegram. A beta by hand is not gated. |
| Alerts | One step shared by `e2e.yml` (scheduled and gate runs) and `replay-offline.yml`: bot `@jobpilotto_ci_alerts_bot`, secrets `CI_ALERTS_TELEGRAM_BOT_TOKEN` + `CI_ALERTS_TELEGRAM_CHAT_ID` (no chat id: the step says so and skips). Text: `🔴 <workflow> failed · main <sha> · <time>`, what failed (suite + test, or rows worse with why), the run link; `🟢 <workflow> back to green` after a failure. Never the token in a log; no AI. |
| Time | ~94 s a row on one macOS runner (10 rows: 938 s, run of #657): 50 rows ≈ 78 min, hence 02:00 for a 04:00 gate. |

**Open (Progress):**
- Positive control: replaying old `62dad23` and main `9a0416d` on the Teamtailor recording must say "worse" for main (the combobox stall, memory project-teamtailor-combobox-stall). Not proven: the snapshot replay did not reproduce that stall, and the Teamtailor recording replays 2/6 tonight (CV-upload gap, the next day's first task). Until it passes, a green run proves only "no row got worse that the replay can see".
- The macOS runner disagrees with the Mac on some rows (Datadog 9/9 on the Mac, 0/9 on the runner). Not a gate risk: such a row is not counted ("not faithful on this runner"); it lowers the tool's health number and is fixed as that, which then lets it count.

## Plan (owner, 13 Oct 2026: one deliverable a day)
- **Day 1:** 10 rows replayed offline on the Mac, shown on /admin/applying "Replay vs live" (#651).
- **Day 2:** PR "Record" (the scrollbar fix + the recorder in the CI pool run) and PR "Replay offline" (a CI job replaying the recorded rows on every PR). Needs the owner's yes on the key as a GitHub secret.
- **Day 3+:** all rows; replace the old replayer (the build PRs above); row-to-case network cases; a signed-in Workday journey with the owner's test account.

## Progress
- [x] History read; options A, B, C compared; B chosen (proof: none: this spec)
- [ ] cc's review
- [x] The owner's yes ("let's prove it", 13 Oct 2026) and decision 1: encrypted CI artifact (proof: none: the encrypted artifact runs on draft #652, not on main)
- [x] P0 + P0b: fixture site recorded and replayed; page side passes, pace open (proof: docs/superpowers/specs/2026-10-13-replay-by-network.md)
- [x] P0c folded into the proof: the memo replays each ask at its live latency (cap raised); the clock, slower replies and CPU were measured not to matter (proof: none: draft #652 replay-net.mjs)
- [x] P1 widened: 6 real rows, 30 of 32 live asks matched (proof: none: draft #652, Proof result above)
- [ ] PRs 0-3 landed; "unverified" lifted
- [x] Schedule, gate and alerts: sketch agreed (owner "yes", 14 Oct 2026); PR A built: Worker cron 02:00 + beside e2e, replay-gate.mjs (outcome vs last green, retry), nightly waits for a green replay, Telegram for e2e + replay (proof: none: PR A, first scheduled run after merge)
- [ ] PR B: the site's "Accept as new baseline" (D1 + API + button), the per-recording faithful flag; then (3) values right
- [ ] (3) Values right, from the bake-off (owner, 14 Oct 2026: its scoring joins this work): read each field's final value from the end page (one DOM reader: job-pilotto-bakeoff `lib/extract-fields.js`: frames, radio/checkbox groups, file names, combobox shown values) and compare with EXPECTED values per field (the fake applicant's facts), required fields first; an empty field the facts cannot answer is right. Expected values per form frozen once from the bake-off's 68 judged runs (`results/runs/*/judged.json`).
- [ ] Positive control via the network replay: the snapshot replay (DOM + CSS, no scripts) did NOT reproduce the Teamtailor regression (Claude's answers arriving after the fill starts, a suggest-only address combobox); a live run and a hand-made page with the page's behaviour did. The network replay keeps the page's scripts and replies and serves the AI at its live latency, so it should; prove it, and add a per-route delay option to make answers arrive late on purpose.
- [ ] Settle time: the bake-off's deterministic replays settle in ~5 s after the last change (~35 s a form) against the live watch's 45 s (25 s after "run ended", #677); try a short settle for offline replays only.
- [ ] Positive control: old 62dad23 vs main 9a0416d on the Teamtailor recording says worse (needs the CV-upload fix and a Mac re-record)
- [ ] When the positive control passes: the skills fix-recorded-sites and record-applying-sites say "measure offline first" again (today: "measure is unverified, measure live")

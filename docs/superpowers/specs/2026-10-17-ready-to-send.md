# Ready to send, phase 1: the server fills at night, you press Submit (17 Oct 2026)

**Verdict:** for the owner only, behind a setting only he has on. Tonight's best matches (fit ≥ 60, up to 10) go to our Cloudflare as one batch; a container browser
fills each **one-page form** with the real extension and stops before Submit. In the morning one page lists them: **live view** (click and type in the server's
browser) or **Open in my browser** (the 155 ms hand-off). **He presses Submit, never the server.** No accounts, no passwords on the server, no pricing.

Owner (17 Oct 2026, via job-pilotto-cc): "Phase 1, just for you. One-page forms filled at night on Cloudflare. In the morning: a web page with the live view, or
'Open in my browser' with the 155 ms hand-off; you press Submit. No accounts, no pricing yet. Measure how many arrive complete before opening it to others."
Sketch with the proof numbers: https://claude.ai/artifact/XRdcdJCBhE3zq4nXLeQ934

## Floors (from the owner, all tested)
| Floor | How it is held |
|---|---|
| The server never presses Submit | the filler has no Submit path (its press list excludes submit; a test fails if the Submit selector is clicked); the page asks the owner |
| No captcha solving by us | a wall = "open in your browser"; the owner may tick a human check inside the live view |
| No accounts, no password on the server | a form behind sign-in = "open in your browser"; no vault, no Keychain, no site password handler in the image |
| His data on Cloudflare only what one night needs | the batch (contact, kit answers, tailored CV and letter for each job) is encrypted at rest and **deleted** (below) |
| Only he sees it | Worker var `READY_OWNER` = his install id; every route refuses any other token; `READY_TO_SEND=off` by default; the app setting is hidden for any other install |
| Cost on `/admin/ai-cost` with a cap | job kind `ready-fill` reports each night's AI and container cost; `READY_NIGHT_MAX_USD` (default $1.00) stops the batch when reached |

## Data: what is stored, where, how it is deleted
- **Stored** (R2 `hosted-state`, key `ready/<install>/<night>/…`, encrypted with the hosted per-account key from `HOSTED_KEK`): per job the url, kit answers, cover letter,
  tailored CV PDF; one contact block. **In D1** `ready_jobs`: id, night, url, platform, state, counts (fields filled / left, human check, wall), timings, cost. Never a
  field value, never a password; logs hold field names and counts only.
- **In memory only:** the browser session and the filled form (the container keeps them until its window ends; no disk).
- **Deleted:** (1) when he presses **Done** on a job or "Clear the morning", (2) automatically **24 h after the batch** whichever comes first, (3) at once on **Delete everything**
  (Settings → Ready to send), which also clears D1 rows older than the counts' 30-day keep. A test lists the R2 keys after each of the three and expects none.
- Counts (not values) stay 30 days for the measurement below.

## How it runs
```
Mac app (setting on)  --push batch (kit, CV, letter, contact)-->  Worker  /ready/batch  (owner-only, encrypted into R2, rows in D1)
Worker queue "hosted-runs" (existing consumer pattern)  -->  container  `ready_fill` (Chromium + the REAL extension, filler only)
  per job: open the posting -> find the form -> the extension fills from the batch -> STOP before Submit -> state: prepared | partial | wall | no-form
  the container holds the filled tabs until the morning window ends (hold ≤ 2 h from "ready by", default 07:30)
Morning: Worker page /ready  (owner token)  ->  per job:  [Live view]  (WebSocket to the container, our CDP screencast)
                                                   [Open in my browser]  (hand-off: URL + cookies/storage + field snapshot -> extension restores, no AI)
                                                   [Done]  (deletes that job's data)
```
- **Live view:** the proof's server (`tools/server-proof/server.mjs`, measured open p50 155 ms, input p50 79 ms) becomes the container's live-view module.
- **Hand-off:** proof result: session kept, 5 of 5 fields restored in ~10 ms, 143-162 ms to restored; storage must travel with cookies (a token held only in `sessionStorage` is
  refused with cookies alone). The extension restores the snapshot deterministically (no AI).
- **The filler is the real extension**, not a new engine (rule: fix a shape, not a site; the extension's brain is the app's local server). The container therefore
  runs the app's extension server headless with only fill handlers (no Notion, Keychain, mail, no account handlers), AI through our `/api/ai` with a run token.
  **First risk, measured in PR 2 before anything else is built on it:** that this runs on a standard-1 container (memory, start time) and fills a one-page fixture form
  completely. If it does not fit, stop and tell the owner before changing the plan.
- **Morning measure (the owner's metric):** one line per morning on `/admin/ready` and in Telegram: **prepared / reached a form / filled completely / he submitted**
  (the last from the existing "Applied" status the app already records). A form counts as *complete* when no required field is left empty (the extension's own count).

## PR plan (not stacked: each from main, each behind its flag, each lands alone)
1. **PR 1 (site):** D1 tables, `READY_*` vars (off), owner-only routes (`/ready/batch`, `/ready/state`, `/ready/done`, `/ready/delete`), encrypted R2 batch, 24 h sweep in the existing
   tick, cost row on `/admin/ai-cost` and the nightly cap, `/admin/ready` morning counts. Tests with in-memory D1 and a fake R2.
2. **PR 2 (container + engine):** image `ready_fill` (Chromium + extension + headless app server with fill handlers), the live-view and hand-off modules from the proof,
   no-Submit guard test, a CI proof on a fictional one-page fixture form (complete fill, time, memory), results into the PR.
3. **PR 3 (app):** the owner-only setting on the Actions card, push of tonight's batch (`desktop/lib/ready.js`: fit ≥ 60, 10 a night, reuse kit + Tailor CV), the extension's
   **restore from snapshot** step for "Open in my browser", ⌘K entries, Focus line and the Telegram morning line, before/after shots.

## Progress
- [x] Sketch B and the proof approved; phase 1 chosen by the owner (17 Oct 2026, via job-pilotto-cc) (proof: none: decisions relayed by cc, see top)
- [x] Proof on Cloudflare: open 155 ms, human check + Submit through the stream, hand-off measured (proof: none: one-off CI run 39047884877, numbers in the sketch; tools/server-proof/)
- [ ] Repeat the stream Submit test that recorded no click in run 6 (proof: none: one-off CI run, result in the PR)
- [ ] PR 1 (site): tables, owner-only routes, encrypted batch, deletion (24 h, Done, Delete everything), cost row + cap, `/admin/ready` (proof: site/test/ready-to-send.test.js)
- [ ] PR 2 (container): ready_fill image, headless fill server, live view, hand-off, no-Submit guard, fixture proof (proof: tests/test_ready_fill.py)
- [ ] PR 3 (app): owner-only setting, batch push, restore step, ⌘K, Focus + Telegram line, shots (proof: desktop/test/ready.test.js)
- [ ] First night measured: prepared / reached / complete / submitted, reported to the owner (proof: none: the morning line on /admin/ready)
- [ ] Delete `tools/server-proof/` and `.github/workflows/server-proof.yml` once the numbers are in this spec (proof: none: removal)
- [ ] Listing: Notion ✨ Feature catalog (3e962be8fd868133aa3ed99f1b0debcd), `site/public/intelligence.html` + teaser, README "AI at every step", landing page: only when it opens beyond the owner

## Not in phase 1
Accounts and passwords on the server, forms behind sign-in, pricing, other users, WhatsApp, multi-step forms beyond what the extension already walks, any Submit by the server.

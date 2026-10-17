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
  **First risk, measured:** locally the real extension fills the fixture forms in ~6 s each with ≈ 1.3 GB for 3 tabs (table below); the container's own fit (memory, start) is measured by the one-off Cloudflare proof when the owner agrees to deploy it (PR 3).
- **Morning measure (the owner's metric):** one line per morning on `/admin/ready` and in Telegram: **prepared / reached a form / filled completely / he submitted**
  (the last from the existing "Applied" status the app already records). A form counts as *complete* when no required field is left empty (the extension's own count).

## PR plan (not stacked: each from main, each behind its flag, each lands alone)
1. **PR 1 (site, merged #1224):** D1 tables, `READY_*` vars (off), owner-only routes, encrypted batch, deletion (24 h, Done, Delete everything), cost cap + `ready-fill` on /admin/ai-cost.
2. **PR 2 (container, `hosted/ready-fill/`):** the night's filler = the REAL extension in headless Chromium + a small stand-in app (the shape `desktop/e2e/lib/real-extension.mjs` already uses), fed only from the batch
   (`/extension/me`, `/extension/kit` by the job's address; every other call empty). Floors in code: the extension copy **holds the account button** (`extension-copy.mjs`, a test fails if the line moves),
   `no-submit.mjs` refuses a form submission, the live view lets only mouse and keys through. Live view + hand-off modules from the proof. Image + a fixture proof (`desktop/e2e/ready-fill-proof.mjs`).
   **No AI in phase 1:** the stand-in answers `/extension/answer` with no answers, so what the kit and the rules do not cover stays open and is counted as left; the first night's numbers say whether AI answers are worth adding.
3. **PR 3 (site wiring, needs the owner's yes before it deploys):** migration `fill_at`, the cron starts due batches and enqueues them (as the hosted tick does), the runner Worker (Container class + queue consumer) and the morning proxy routes
   (live view, hand-off, state). New Cloudflare things it needs: a Queue `ready-runs` and a Worker `www-ready-runner` (container, standard-1). Nothing is created until the owner says so.
4. **PR 4 (app):** the owner-only setting on the Actions card, push of tonight's batch (`desktop/lib/ready.js`: fit ≥ 60, 10 a night, reuse kit + Tailor CV), the extension's **restore from snapshot** step for "Open in my browser", ⌘K entries, Focus line, Telegram morning line, before/after shots.
   (Four PRs, not three: wiring needs the owner's account decision, so it cannot ride with the container; each is small and lands alone.)

## Measured on the fixtures (17 Oct 2026, Mac, `ready-fill-proof.mjs`, fictional data)
| Form | Result | Filled / required left | Seconds |
|---|---|---|---|
| Greenhouse-style | prepared | 9 / 0 | 6 |
| Lever-style | partial | 6 / 1 | 6 |
| One-page (Workday host) | partial | 7 / 2 | 6 |
Browser memory for 3 held tabs ≈ 1.3 GB (standard-1 has 4 GiB). 0 submits touched, 0 form posts. Partial = questions the kit does not cover (needs AI; phase 1 has none).

## Progress
- [x] Sketch B and the proof approved; phase 1 chosen by the owner (17 Oct 2026, via job-pilotto-cc) (proof: none: decisions relayed by cc, see top)
- [x] Proof on Cloudflare: open 155 ms, human check + Submit through the stream, hand-off measured (proof: none: one-off CI run 39047884877, numbers in the sketch; tools/server-proof/)
- [x] Repeat the stream Submit test that recorded no click in run 6: accepted again in run 8, 2 of 3 runs (proof: none: one-off CI runs 39047884877 and 39048751160, tools/server-proof/)
- [x] PR 1 (site): tables, owner-only routes, encrypted batch, deletion (24 h, Done, Delete everything), cost row + cap (#1224) (proof: site/test/ready-to-send.test.js @c605c1c)
- [ ] PR 2 (container): extension copy that holds the account button, stand-in app, no-Submit net, live view, hand-off, image, fixture proof (proof: desktop/test/ready-fill.test.js)
- [ ] PR 3 (site wiring): fill_at, cron start + queue, runner Worker, morning proxy; deploy only after the owner's yes to a Queue and a Worker (proof: site/test/ready-wiring.test.js)
- [ ] PR 4 (app): owner-only setting, batch push, restore step, ⌘K, Focus + Telegram line, shots (proof: desktop/test/ready.test.js)
- [x] PR 4a (app): Actions card shown only to the owner's install (site says), Send tonight, Run now, morning rows with Done, ⌘K entry, batch with CV + letter PDF + facts (proof: desktop/test/ready-batch.test.js)
- [x] PR 5a+5c: live view page (`site/public/ready-live.html`, opened by a 10-minute link), "I submitted it" marks Applied and deletes, Focus line, morning notification (proof: site/test/ready-link.test.js)
- [ ] PR 5b: "Open in my browser" (extension restore step), after the first night (proof: none: not built)
- [ ] First night measured: prepared / reached / complete / submitted, reported to the owner (proof: none: the morning line on /admin/ready)
- [x] Site wiring (written, NOT deployed): fill time on a batch, cron tick starts due nights via Queue `ready-runs`, finishes over-time nights, morning routes `live`/`handoff`/`held` through a service binding, runner Worker `site/ready-runner` (proof: site/test/ready-wiring.test.js)
- [ ] Owner yes, then create Queue `ready-runs` + Worker `www-ready-runner`, add `READY_RUNNER` binding and `READY_QUEUE` producer to the site config (proof: none: account change, owner's decision)
- [x] AI answers at night (owner 17 Oct 2026): the stand-in runs the Worker's answerForm on the batch's facts; every model call goes through the site (`/api/ready/ai`, night token, counted toward the $1 cap; no product key: see the next line); form questions only, not page-kind/judge calls (proof: worker/test/ready-night-ai.test.js @8c328f5)
- [x] The night's AI is the user's own (owner 17 Oct 2026: "not part of the product... Free AI, or their own BYOK"): his Claude key sealed with the batch (BYOK, real model), else his Free AI minted by the site (its per-install limits); a refusal or the cap marks the night "AI stopped" and the card says so; measured ≈ 8.3k tokens in / 0.8k out per form, 1 call: Free AI ≈ $0.0007/form (15 forms ≈ $0.01 of the $0.50/day), BYOK Sonnet ≈ $0.025/form (15 ≈ $0.37 of the $1 night cap) (proof: site/test/ready-ai.test.js)
- [ ] Delete `tools/server-proof/` and `.github/workflows/server-proof.yml` once the numbers are in this spec (proof: none: removal)
- [ ] Listing: Notion ✨ Feature catalog (3e962be8fd868133aa3ed99f1b0debcd), `site/public/intelligence.html` + teaser, README "AI at every step", landing page: only when it opens beyond the owner

## Not in phase 1
Accounts and passwords on the server, forms behind sign-in, pricing, other users, WhatsApp, multi-step forms beyond what the extension already walks, any Submit by the server.

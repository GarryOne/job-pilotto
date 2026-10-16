# Hosted Always on for Pro: scheduled searches on our Cloudflare (16 Oct 2026)

**Verdict:** a Pro switch "Search for me while my Mac is off" that runs the person's searches **on our Cloudflare Containers**, not on GitHub Actions. No GitHub, Notion or Telegram setup. New matches appear in the app (optional push/Telegram later). AI is debited from the Pro credit through the existing route. **Compute is about $0.0025 a run (estimate), under $0.50 a month at 6 runs a day**: we absorb it. Nothing is built; behind `HOSTED_ALWAYS_ON=off`, after Pro launches.

Owner (16 Oct 2026, via job-pilotto-cc): "in the Pro version, can we offer users the GitHub Actions from the house, in their Credit? that would be a good selling point."
cc's answer, kept here: yes as a selling point, **not on our GitHub Actions** (GitHub's terms cover CI of a repo, not a compute service for many customers; the account all our CI depends on would be at risk; minutes cost; a shared concurrency limit; users' data would pass through our runs).

## History read first
- Always on = the user's **own** private repo calling `GarryOne/job-pilotto/.github/workflows/daily.yml@main` with their secrets; set up by `desktop/lib/github.js` (`fd6357f` 28 Sep rename, `b1c5fcc` Google sign-in, `24ae4fd` 8 Oct kept in step at each start). Notion is required there (state also lives in a GitHub cache + artifact backup of `jobs.sqlite`).
- The store interface (`1e1eef0`, `src/stores/`: SQLite default, Notion adapter) means the engine already runs on a **SQLite store with no Notion**. That is what makes a hosted run possible.
- Pro (`docs/superpowers/specs/2026-10-16-pro-plan.md`, PRs 1-2 on main): accounts, `pro_accounts`, credit ledger `pro_credit`, `pro-ai.js` lane on `/api/ai/v1/messages` (50/min only, $0.25 overdraft, no free fallback at 0).
- Nothing in history built a hosted runner or a per-user cron; the site Worker has one daily cron (`30 5 * * *`) and the account has "no cron triggers left" on the Free-plan count (now Workers Paid: 250 allowed).

## 1. Where it runs

| Option | What | Verdict |
|---|---|---|
| **A. Cloudflare Containers** | the Python engine as-is, one container per run | **Recommended** |
| B. Port to Workers | rewrite crawl, parsers, scoring in JS | No: 150+ Python files; 128 MB memory, 30 s default CPU; doubles the code to keep in step |
| C. Hybrid (crawl in a container, AI via our route) | A, with AI never leaving the Worker | **This is A**: the container holds no AI key, it calls our route with a run token |
| D. Our GitHub Actions | | Rejected (above) |

**Design (A):**
```
Cron Trigger (every 15 min, one) -> Worker scans D1 hosted_schedules for due rows
   -> Queue "hosted-runs" (one message per user, dedupe by user+slot)
   -> consumer starts a Container (engine image, instance "basic")
        1. pulls the user's state from R2 (jobs.sqlite, config)   2. python -m src daily --mode scheduled  (SQLite store)
        3. AI calls -> our /api/ai route with a short-lived RUN TOKEN (Pro lane, debits the credit)
        4. pushes state back to R2, posts a result summary to the Worker -> D1 hosted_runs + new matches
   -> container exits (billed only while running)
```
- **One cron, not one per user:** per-user crons would hit the 250-trigger cap at 250 users. A single 15-minute tick plus a `next_run_at` column scales to any number of users.
- **The image** is the public engine at the app's release tag (same code the Mac runs; `requirements.txt` only: `anthropic`, `openai` not needed as AI is our route). No Playwright: the engine's crawl is HTTP (`src/sources`).
- **The container holds no long-lived secret:** a run token (bound to account + run, expires in 30 min) lets it call `/api/ai` and post results. Boards are public; login walls are never crossed (safety rules unchanged).
- **Limits that bite** (Cloudflare docs, Oct 2026): instance `basic` = 1/4 vCPU, 1 GiB, 4 GB disk; account 1,500 vCPU / 6 TiB RAM concurrent (≈ 1,500 `basic` runs at once, far above need); `max_instances` default 20, raise as needed; Queue consumers handle bursts; Worker CPU per cron 30 s (the Worker only enqueues). A run longer than 15 min is cut by our own timeout (as `daily.yml`'s `timeout-minutes: 15`).
- **Risk to prove first:** cold start of the Python image (seconds) and a run's real wall time and memory. Probe below.

## 2. Data, privacy, deletion
- **One copy per person, behind the store interface** (rule `data-ownership.md`): a hosted user's store is **their SQLite file in R2**, `hosted/<account>/jobs.sqlite` (+ `config/search.json`, `profile.md`, CV text as the app sent them), **encrypted at rest with a key per account** derived from a Worker secret (`HOSTED_KEK`). Not in D1 (rows per user would grow our D1 limits); D1 holds only the schedule, run log and the **result inbox** (new matches, ≤ 200 rows per account, 30 days).
- **Sync with the app:** the app **pushes** profile + search settings + CV text when the switch goes on and whenever they change; it **pulls** the result inbox at start and every few minutes while open, merges the matches into its own store (the Mac's store stays the primary copy). Hosted `jobs.sqlite` is a cache the Mac can rebuild, like the GitHub cache today; losing it re-scores nothing the Mac already has.
- **Notion:** optional, **never required**. v1: no Notion in hosted runs (the app writes to the person's Notion when it merges the inbox, as it does for any run). Hosted Notion tokens = out of scope v1.
- **Export and delete (the user owns it):** Settings → Hosted search: "Download my hosted data" (R2 file + inbox as a zip) and "Delete everything": turns the switch off, deletes R2 objects, schedule, run rows and inbox at once, returns a receipt. Account closure or refund of Pro (`charge.refunded`) does the same within 7 days. Written in `privacy.html` (PR 4 of the Pro plan) in two lines.
- **Credentials:** **out of scope for v1:** no Gmail/mail tracking, no Google sign-in, no Telegram token, no user API key stored (Pro uses our route; own-key users keep the Mac). Reason: storing a person's mailbox grant on our side is a different trust level and a breach story; add only with its own spec. Hosted v1 = **find, score, and list jobs**, plus the optional insight. Apply, kits, interviews, mail stay on the Mac.
- **Retention:** run logs 30 days, result inbox 30 days, the SQLite file for as long as the switch is on; 30 days after it goes off or Pro ends.

## 3. Cost per Pro user per month

Prices: Cloudflare Containers (Workers Paid, 5 Oct 2026 docs): memory $0.0000025/GiB-s (25 GiB-h/month included), CPU $0.00002/vCPU-s of **active** use (375 vCPU-min included), disk $0.00000007/GB-s, egress $0.025/GB (1 TB included). Plus Worker/Queue/R2 pennies.

**Assumed run (ESTIMATE until probed):** `basic`, 6 min wall (the crawl waits on the network), CPU active 30% of 1/4 vCPU, 20 MB egress, state 1 MB in/out.

| Part | Per run | Math |
|---|---|---|
| Memory | $0.0009 | 1 GiB × 360 s × $0.0000025 |
| CPU | $0.0005 | 0.25 vCPU × 30% × 360 s × $0.00002 |
| Disk | $0.0001 | 4 GB × 360 s × $0.00000007 |
| Egress | $0.0005 | 0.02 GB × $0.025 |
| Worker, Queue, D1, R2 ops | $0.0003 | rounded up |
| **Compute total** | **≈ $0.0025** | no included allowance counted |

| Schedule | Runs/month | Compute, **our cost** | AI |
|---|---|---|---|
| 1 / day | 30 | ≈ $0.08 | credit |
| every 12 h | 60 | ≈ $0.15 | credit |
| every 4 h (as GitHub today) | 180 | ≈ $0.45 | credit |
| **Cap: 6 / day** | 180 | ≈ $0.45 | credit |

- The Workers Paid allowance (25 GiB-h memory ≈ 250 runs a month) covers the first ~1.4 users at 6/day; ignore it for the table.
- **AI is the real cost and does not scale with run count:** it follows **new jobs**, not runs (an empty run costs the small-model title triage, ~$0.001). The Pro spec's average search is ≈ $5 over ~3 months, 60-70% of it reading and scoring jobs; Always on **scores the same jobs earlier, it does not add jobs**. So a typical search with Always on stays in the **$3.5-5 band: the $5 credit still covers an average search**, a heavy one tops up (same as today). Risk: a person who never opens the app keeps scoring new jobs for months; the credit is the cap and it pauses at 0 like all AI.
- **What is debited from the credit:** the AI calls of hosted runs, exactly as app calls (`ai_calls` micro-USD → `pro_credit`, action `hosted-run`). **Compute is not debited** (invisible, ≈ $0.15 a typical month, 1% of a $19 sale after VAT and fees: ≈ $14.9 left). Alternative if usage grows: debit a flat $0.005 a run; decided later from measured cost.
- **Not measured yet.** Replace the table by the probe's numbers before launch.

## 4. Product
- **Settings → Plan → "Search for me while my Mac is off"** (Pro only), one switch + frequency choice: **once a day (default)**, twice a day, every 4 hours (the cap, 6/day). Built from `choiceCards`/existing parts; ⌘K "Turn hosted search on/off"; sidebar line "Hosted search · next 14:00".
- **What the person sees:** the Matches/Jobs screen shows new matches that arrived while the app was closed ("12 new while you were away"); Recent activity gets a "Hosted search" run card (same card as other search runs: count, top matches, AI cost as the credit bar). Optional push/Telegram: **v2** (needs the Telegram token or web push; out of v1).
- **Credit at 0:** hosted runs **pause** (crawl-only runs are still cheap but the scoring needs AI; we pause the whole schedule, no unscored list), the card says "Paused: AI credit used up. Top up, or use your own key on this Mac." Resumes at the next top-up. Warnings at 30%/10% reuse the Pro ones.
- **Free users never get it.** Free users keep the own-repo Always on during the trial; when the trial ends, GitHub Always on is Pro only (owner, 16 Oct; `job-pilotto-31` counts CI against the trial). Pro users may keep the old GitHub path or switch to hosted; both on at once is refused (one schedule per account).
- **Existing GitHub Always on:** unchanged by this spec. A later spec may retire it for Pro in favour of hosted.
- Wording: "Search for me while my Mac is off", never "GitHub", "container" or dollars; credit shown as the bar (Pro wording rules).

## 5. Abuse and limits
| Case | Guard |
|---|---|
| Many schedules per person | **one schedule per account**; `UNIQUE(account)` in `hosted_schedules` |
| Too frequent | minimum interval **4 h** (6/day); the tick refuses earlier `next_run_at` |
| Overlap / double run | queue dedupe key `account:slot`; a running row blocks the next |
| Runaway cost | per-account guard: **hosted compute ≤ $1.50 a month** (≈ 600 runs, a bug net), then the schedule pauses and flags; AI is capped by the credit |
| Global spend | `HOSTED_ALWAYS_ON` = `off` / `on` kill switch; `HOSTED_MAX_RUNS_DAY` global cap (e.g. 2,000); alert when the day's compute passes $5 (same pattern as `FREE_AI_ALERT_USD`) |
| Stolen run token | bound to account + run id, 30 min, one result post; useless for other routes |
| Pro refunded / disputed | schedule off, data deleted per §2 |
| Stale/inactive user | no app contact for **30 days** → schedule pauses ("open the app to resume") so a lost Mac does not cost forever |
| Abuse of boards | runs obey `robots`-style limits the engine already has; one request pace per host (existing); no login walls |

## 6. Build plan (all behind `HOSTED_ALWAYS_ON=off`, after Pro launches)
1. **Probe** (cc's OK, ≈ $0.01): one container run of the engine on a fixture profile; record wall time, peak memory, egress, cold start. Replaces the §3 table.
2. **PR 1 (site):** D1 `hosted_schedules`, `hosted_runs`, `hosted_inbox`; run tokens; routes to set/read schedule, post result; flag; tests (in-memory D1, fake clock).
3. **PR 2 (engine + image):** a `--hosted` entry that reads state from a directory, runs the SQLite-store search, AI via run token; Dockerfile; contract test that the SQLite store round-trips through R2.
4. **PR 3 (site):** cron tick + Queue + container start; cost counters; global/per-account guards; kill switch; export and delete.
5. **PR 4 (app):** push config/CV, pull inbox and merge, Settings switch, sidebar, ⌘K, run card, credit-0 pause text, before/after shots.
6. **PR 5 (site pages):** pricing line, privacy two lines, terms.
7. **Test-mode end to end** with a Pro test account; owner flips `HOSTED_ALWAYS_ON=on`.

Tests: the loop covers **every** pause reason (credit 0, inactive 30 days, compute cap, kill switch, refund) and every hosted-run outcome; nothing touches the owner's account, Notion or the real Stripe.

## Open questions for the owner
1. **Default frequency** once a day (cheapest, enough for most) vs every 4 h like today?
2. **Compute not debited** (recommended) or a small flat debit per run?
3. Is **no Gmail/Telegram/Notion in v1** (find, score, list only; the rest on the Mac) acceptable for the selling point?
4. OK for the **probe** (≈ $0.01 of Containers)?

## Progress
- [ ] Spec read by the owner; questions answered (proof: owner via job-pilotto-cc)
- [ ] Probe: container run measured, §3 table replaced by numbers (proof: this file's §3)
- [ ] PR 1 (site): tables, tokens, routes, flag (proof: site/test/hosted-schedule.test.js)
- [ ] PR 2 (engine + image): `--hosted` entry, Dockerfile, R2 round-trip (proof: tests/test_hosted_run.py)
- [ ] PR 3 (site): cron tick, Queue, container start, guards, export and delete (proof: site/test/hosted-guards.test.js)
- [ ] PR 4 (app): switch, inbox merge, sidebar, ⌘K, run card, shots (proof: desktop/test/hosted-search.test.js)
- [ ] PR 5 (site pages): pricing, privacy, terms
- [ ] Test-mode end to end; owner flips `HOSTED_ALWAYS_ON=on`
- [ ] Notion "⭐ Pro plan" updated to match (after the owner's yes)

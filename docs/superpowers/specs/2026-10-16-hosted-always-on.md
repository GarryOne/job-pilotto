# Hosted Always on for Pro: scheduled searches on our Cloudflare (16 Oct 2026)

**Verdict:** a switch (Pro, and Free during the trial) "Search for me while my Mac is off" that runs the person's searches **on our Cloudflare Containers**, not on GitHub Actions. No GitHub, Notion or Telegram setup. New matches appear in the app (optional push/Telegram later). AI is debited from the Pro credit through the existing route. **Compute costs us about $0.0025 a run (estimate); the person is debited a flat $0.005 a run from their credit (or trial budget)**, the same rule as AI keys: their own resources are unlimited, ours are debited. Nothing is built; behind `HOSTED_ALWAYS_ON=off`, after Pro launches.

Owner (16 Oct 2026, via job-pilotto-cc): "in the Pro version, can we offer users the GitHub Actions from the house, in their Credit? that would be a good selling point."
cc's answer, kept here: yes as a selling point, **not on our GitHub Actions** (GitHub's terms cover CI of a repo, not a compute service for many customers; the account all our CI depends on would be at risk; minutes cost; a shared concurrency limit; users' data would pass through our runs).

## History read first
- Always on = the user's **own** private repo calling `GarryOne/job-pilotto/.github/workflows/daily.yml@main` with their secrets; set up by `desktop/lib/github.js` (`fd6357f` 28 Sep rename, `b1c5fcc` Google sign-in, `24ae4fd` 8 Oct kept in step at each start). Notion is required there (state also lives in a GitHub cache + artifact backup of `jobs.sqlite`).
- The store interface (`1e1eef0`, `src/stores/`: SQLite default, Notion adapter) means the engine already runs on a **SQLite store with no Notion**. That is what makes a hosted run possible.
- Pro (`docs/superpowers/specs/2026-10-16-pro-plan.md`, PRs 1-2 on main): accounts, `pro_accounts`, credit ledger `pro_credit`, `pro-ai.js` lane on `/api/ai/v1/messages` (50/min only, $0.25 overdraft, no free fallback at 0).
- Nothing in history built a hosted runner or a per-user cron; the site Worker has one daily cron (`30 5 * * *`) and the account has "no cron triggers left" on the Free-plan count (now Workers Paid: 250 allowed).

## 0. The rule: own resources unlimited, ours debited (owner, 16 Oct 2026)
| Case | Compute | AI | Debited from credit |
|---|---|---|---|
| Pro + own GitHub Actions + own AI key | theirs | theirs | **nothing, unlimited** |
| Pro + own GitHub Actions + our AI | theirs | ours | AI only |
| Pro + **hosted** + our AI | ours | ours | **compute + AI** |
| Pro + **hosted** + own AI key | ours | theirs | **compute only** |
| Free trial + hosted | ours | ours | compute + AI from the **$2 trial budget** (§4b) |
- "Their own Cloudflare account" is **not offered** (deploying into users' accounts is too much support); the bring-your-own option is GitHub Actions.
- Hosted + own key: the run would use the key on our container, so the key is sent to us for the run. **v1: not offered** (a user key stored on our side is the credentials question of §2); the row is priced for later. v1 hosted = our AI.

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
- **What is debited:** AI calls exactly as app calls (`ai_calls` micro-USD → `pro_credit`), **plus compute at a flat $0.005 a run** (about 2x the estimated $0.0025: covers the estimate's error, spikes and support share; `pro_credit` rows with action `hosted-compute`, one per finished run, never for a run that failed before the crawl). The price is a Worker var (`HOSTED_RUN_MICRO=5000`), re-set after the probe (price = 2x measured, rounded up to $0.001).
- **Compute debit per month (Pro credit $5):**
  | Schedule | Runs/month | Compute debit | Share of the $5 credit |
  |---|---|---|---|
  | 1 / day (default) | 30 | $0.15 | 3% |
  | every 12 h | 60 | $0.30 | 6% |
  | every 4 h (cap) | 180 | $0.90 | 18% |
  The credit still covers an average search **with** hosted once a day (AI $3.5-5 + compute $0.45 over 3 months). Every-4-h users spend a visible slice on compute; Settings shows "Hosted search used N% this month" on the same credit bar.
- **Margin on the debit:** about $0.0025 a run; unspent credit stays our margin as for AI.
- **Trial user** (1 run a day, 60 days max): 60 runs ≈ **$0.15 our compute cost**, debit $0.30 from the $2 trial budget; the AI of a Free search is the rest of the $2.
- **Not measured yet.** Replace the table by the probe's numbers before launch.

## 4. Product
- **Settings → Plan → "Search for me while my Mac is off"** (Pro only), one switch + frequency choice: **once a day (default)**, twice a day, every 4 hours (the cap, 6/day). Built from `choiceCards`/existing parts; ⌘K "Turn hosted search on/off"; sidebar line "Hosted search · next 14:00".
- **What the person sees:** the Matches/Jobs screen shows new matches that arrived while the app was closed ("12 new while you were away"); Recent activity gets a "Hosted search" run card (same card as other search runs: count, top matches, AI cost as the credit bar). Notifications: see §4c.
- **Credit at 0:** hosted runs **pause** (crawl-only runs are still cheap but the scoring needs AI; we pause the whole schedule, no unscored list), the card says "Paused: AI credit used up. Top up, or use your own key on this Mac." Resumes at the next top-up. Warnings at 30%/10% reuse the Pro ones.
- **Own-repo Always on during the trial** stays; when the trial ends, GitHub Always on is Pro only (owner, 16 Oct; `job-pilotto-31` counts CI against the trial). A person may keep the GitHub path or switch to hosted; both on at once is refused (one schedule per account).

### 4b. Free trial users can try it (owner, 16 Oct 2026: "free users/trials should also be able to experience this")
- Same one switch during the trial (20 applications or 60 days). **Once a day only** (the Pro choices appear after Pro).
- **Costs come out of the same $2 lifetime trial budget as Free AI** (`FREE_AI_TRIAL_USD`): AI as today, compute at the same $0.005 a run. No separate allowance. They count against the **global Free AI caps** ($10/day stop, $100/month): a trial run's compute joins the day's Free AI total.
- **Ends** (trial over, or the $2 used): hosted **pauses** with "Get Pro to keep Always on running". **The schedule, inbox and R2 state are kept** 30 days after the trial ends (then deleted per §2), so it resumes the moment they buy Pro (the account links to the same install).
- Trial cost to us: 60 runs × $0.0025 ≈ $0.15 compute, inside the $2 budget already counted per free user.
- **Existing GitHub Always on:** unchanged by this spec. A later spec may retire it for Pro in favour of hosted.
- Wording: "Search for me while my Mac is off", never "GitHub", "container" or dollars; credit shown as the bar (Pro wording rules).

### 4c. Notifications (owner, 16 Oct 2026: "Email + app now, WhatsApp later")
| Channel | When | Default | Cost |
|---|---|---|---|
| **Email** | v1 | **on for everyone**, trial and Pro | Cloudflare Email Sending, the same path as the Pro sign-in codes; cents per thousand, ours, not debited |
| **App notification** (Mac/Windows) | v1 | on | none; for anyone with the app open, from the inbox pull |
| **Telegram** | stays | option (the token and chat stay on the Mac; a hosted run reaches Telegram only if the person later connects it in a separate spec) | none |
| **WhatsApp** | **after Pro launches** | off | Meta business verification and approved templates; cents per message, **debited from the credit** |
- **Content:** the same "N new matches" card as Telegram (top matches with fit, one line each), each with a link that opens the job in the app (`jobpilotto://job/<id>`, falling back to the website's "open in the app" page).
- **Frequency:** **one digest per run, never one message per job**; and **only when the run found new matches** (an empty run sends nothing). At most one email per 4 h even on the 4-h schedule; a day's second digest is merged if the first has not been opened. Quiet by design.
- **Where the setting lives:** Settings → Plan → Hosted search → "Tell me by": Email (address shown, change it), App notifications, Telegram (existing). ⌘K "Hosted search: notifications". The address is the Pro account's e-mail; a trial user is asked for one when turning the switch on (stored with the schedule, deleted with it, §2).
- **Unsubscribe:** every email has a one-click unsubscribe link (signed token, no sign-in) that turns the email channel off for that schedule (`List-Unsubscribe` header too), plus the switch in Settings. Turning the schedule off, deleting the data or ending the trial deletes the address.
- **Abuse:** the sender is rate-limited per address (max 6 a day) and per account; a bounce or complaint turns email off automatically.
- E-mail depends on the Cloudflare Email Sending path of Pro PR 5 (device codes): the same sender, domain and templates.

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
| Free trial hosts many installs | one schedule per install; trial hosted runs capped by `HOSTED_TRIAL_MAX_RUNS_DAY` (global) before Pro runs are touched; shares the Free AI global stop |
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
2. Flat **$0.005 a run** compute debit (2x the estimate) OK? Trial: once a day, from the $2 budget.
3. Is **no Gmail/Telegram/Notion in v1** (find, score, list only; the rest on the Mac) acceptable for the selling point?
4. OK for the **probe** (≈ $0.01 of Containers)?

## Progress
- [x] Owner model added: own resources unlimited, ours debited; trial users can try it (16 Oct, via job-pilotto-cc)
- [ ] Spec read by the owner; questions answered (proof: owner via job-pilotto-cc)
- [ ] Probe: container run measured, §3 table replaced by numbers (proof: this file's §3)
- [ ] PR 1 (site): tables, tokens, routes, flag (proof: site/test/hosted-schedule.test.js)
- [ ] PR 2 (engine + image): `--hosted` entry, Dockerfile, R2 round-trip (proof: tests/test_hosted_run.py)
- [ ] PR 3b (site): compute debit rows (`hosted-compute`), trial budget and global-cap accounting, pause/resume on Pro (proof: site/test/hosted-debit.test.js)
- [ ] PR 3 (site): cron tick, Queue, container start, guards, export and delete (proof: site/test/hosted-guards.test.js)
- [ ] PR 3c (site): digest e-mail through Cloudflare Email Sending, unsubscribe token, bounce handling (proof: site/test/hosted-notify.test.js)
- [ ] PR 4 (app): switch, inbox merge, sidebar, ⌘K, run card, shots (proof: desktop/test/hosted-search.test.js)
- [ ] Later: WhatsApp channel (Meta verification, templates, credit debit), after Pro launches
- [ ] PR 5 (site pages): pricing, privacy, terms
- [ ] Test-mode end to end; owner flips `HOSTED_ALWAYS_ON=on`
- [ ] Notion "⭐ Pro plan" updated to match (after the owner's yes)

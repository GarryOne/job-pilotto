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
- **What is debited:** AI calls exactly as app calls (`ai_calls` micro-USD → `pro_credit`), **plus compute at a flat $0.008 a run** (2x the measured $0.0039 on standard-1; first estimate $0.0025 on basic: covers the estimate's error, spikes and support share; `pro_credit` rows with action `hosted-compute`, one per finished run, never for a run that failed before the crawl). The price is a Worker var (`HOSTED_RUN_MICRO=8000`), re-set after the probe (price = 2x measured, rounded up to $0.001).
- **Compute debit per month (Pro credit $5):**
  | Schedule | Runs/month | Compute debit | Share of the $5 credit |
  |---|---|---|---|
  | 1 / day (default) | 30 | $0.15 | 3% |
  | every 12 h | 60 | $0.30 | 6% |
  | every 4 h (cap) | 180 | $0.90 | 18% |
  The credit still covers an average search **with** hosted once a day (AI $3.5-5 + compute $0.45 over 3 months). Every-4-h users spend a visible slice on compute; Settings shows "Hosted search used N% this month" on the same credit bar.
- **Margin on the debit:** about $0.0025 a run; unspent credit stays our margin as for AI.
- **Trial exposure with default-on** (owner, 16 Oct; ESTIMATE, AI per run is not probed because the engine has no AI key in the probe):
  | Per trial user | Runs | Compute (ours) | AI (ours) | Total |
  |---|---|---|---|---|
  | **Worst case** (never pauses, spends the $2 trial budget) | 60 | $0.15 | ≤ $1.70 (the $2 budget minus the $0.30 compute debit) | **≈ $1.85** |
  | **Likely** (14-day auto-pause when unused, ~25% stay engaged the full 60 days) | ~29 avg | $0.07 | ≈ $0.40 (assumes AI follows new jobs, ~$3.5 per 90 days for a heavy engaged searcher; lower for idle ones) | **≈ $0.50** |
  | New installs a month | Worst case | Likely |
  |---|---|---|
  | 100 | ≈ $185 | ≈ $50 |
  | 1,000 | ≈ $1,850 | ≈ $500 |
  - **The global Free AI caps bind first:** $10/day stop and, **decided by the owner on 16 Oct 2026, a $200/month stop with an alert at $100** (was $100/$70; `FREE_AI_MONTH_STOP_USD`/`FREE_AI_MONTH_ALERT_USD` in `site/wrangler.toml`, changed in its own small site PR with the tests and docs). At 100 installs a month the likely case ($50) fits; at ~400 it reaches the new stop; at 1,000 (likely $500) the cap would still stop Free AI and hosted mid-month. **Owner decision needed before default-on goes live at scale:** raise the monthly caps (the early-adopter values in `wrangler.toml` are config), or lower the trial budget for hosted.
  - Conversion has to carry it: at $19, a conversion of c% of installs covers the likely $0.50 per install if c ≥ ~3-4% (net after VAT and fees ≈ $14).
- **Trial user** (1 run a day, 60 days max): 60 runs ≈ **$0.15 our compute cost**, debit $0.30 from the $2 trial budget; the AI of a Free search is the rest of the $2.
- **Measured locally, 16 Oct 2026** (the engine, `JOB_PILOTTO_STORE=sqlite`, empty state, an isolated app folder and no keys, config = the repo's example search; a Mac, not a container): **147 s wall, 33 s user + 6 s system CPU (≈ 27% of one core), peak memory ≈ 0.8 GB (RSS) / 1.2 GB (macOS footprint)**, 1,068 employer feeds read, 8,883 jobs listed, 142 new, no AI. **Consequences for the estimate above:** `basic` (1 GiB) is too small, use **`standard-1` (1/2 vCPU, 4 GiB, 8 GB disk)**; a later run with a warm state reads the same feeds, so 147 s is the planning figure.
  | Part (standard-1, 147 s) | Per run, measured basis |
  |---|---|
  | Memory 4 GiB × 147 s × $0.0000025 | $0.00147 |
  | CPU 39 s active × $0.00002 | $0.00078 |
  | Disk 8 GB × 147 s × $0.00000007 | $0.00008 |
  | Egress (not measured yet; assume 50 MB) | $0.00125 |
  | Worker, Queue, D1, R2 | $0.0003 |
  | **Total** | **≈ $0.0039** |
  The debit is **$0.008 = 2x the measured $0.0039** (owner, 16 Oct 2026); the container probe measures egress and the Linux footprint, and the debit is re-checked against it before launch (rule: 2x the measured cost). The earlier table above stays as the first estimate.

## 4. Product
- **Settings → Plan → "Search for me while my Mac is off"** (Pro only), one switch + frequency choice: **once a day (default)**, twice a day, every 4 hours (the cap, 6/day). Built from `choiceCards`/existing parts; ⌘K "Turn hosted search on/off"; sidebar line "Hosted search · next 14:00".
- **What the person sees:** the Matches/Jobs screen shows new matches that arrived while the app was closed ("12 new while you were away"); Recent activity gets a "Hosted search" run card (same card as other search runs: count, top matches, AI cost as the credit bar). Notifications: see §4c.
- **Credit at 0:** hosted runs **pause** (crawl-only runs are still cheap but the scoring needs AI; we pause the whole schedule, no unscored list), the card says "Paused: AI credit used up. Top up, or use your own key on this Mac." Resumes at the next top-up. Warnings at 30%/10% reuse the Pro ones.
- **Own-repo Always on during the trial** stays; when the trial ends, GitHub Always on is Pro only (owner, 16 Oct; `job-pilotto-31` counts CI against the trial). A person may keep the GitHub path or switch to hosted; both on at once is refused (one schedule per account).

### 4b. Free trial users can try it (owner, 16 Oct 2026: "free users/trials should also be able to experience this")
- **ON BY DEFAULT for trial users** (owner, 16 Oct 2026: "enable this by default, to catch them in the loop, to be present in their day-to-day life for a few weeks. This will increase the conversion rate").
- **Onboarding shows the switch already on**, with one disclosure line right under it: *"Searches run daily on our servers, even when your Mac is off. Your profile is stored encrypted; turn it off anytime and it's deleted."* Turning it off deletes the hosted data at once (§2).
- **Onboarding gets an email field.** Needed for the daily digest and the same address Pro sign-in will use (one address per person, stored once with the install, linked to the Pro account at purchase). Without an address the switch cannot be on; the person can skip the field, and hosted then stays off (app notifications only on the Mac).
- Same one switch during the trial (20 applications or 60 days). **Once a day only** (the Pro choices appear after Pro).
- **Auto-pause after 14 days with no app open and no email click** (an open of the app, a click in any email, or "Resume" counts). Every email has a one-click **"stop daily searches"** link. A paused schedule keeps its data for 30 days, then it is deleted (§2).
- **Consent check (before live; not legal advice):** a default-on digest to an address the person typed in onboarding is a service message they asked for; it must carry **no promotion** (the only upsell line is the pause notice "Get Pro to keep Always on running"). Marketing mail would need its own opt-in. Ask the accountant/lawyer with the VAT question.
- **Costs come out of the same $2 lifetime trial budget as Free AI** (`FREE_AI_TRIAL_USD`): AI as today, compute at the same $0.008 a run. No separate allowance. They count against the **global Free AI caps** ($10/day stop, $100/month): a trial run's compute joins the day's Free AI total.
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
- **Where the setting lives:** Settings → Plan → Hosted search → "Tell me by": Email (address shown, change it), App notifications, Telegram (existing). ⌘K "Hosted search: notifications". The address is the Pro account's e-mail; a trial user gives it in onboarding (§4b; stored with the schedule, deleted with it, §2).
- **Unsubscribe:** every email has a one-click unsubscribe link (signed token, no sign-in) that turns the email channel off for that schedule (`List-Unsubscribe` header too), plus the switch in Settings. Turning the schedule off, deleting the data or ending the trial deletes the address.
- **Abuse:** the sender is rate-limited per address (max 6 a day) and per account; a bounce or complaint turns email off automatically.
- E-mail depends on the Cloudflare Email Sending path of Pro PR 5 (device codes): the same sender, domain and templates.

### 4d. Email + signups (owner, 16 Oct 2026: "we'll need an email for them... On the wizard. Also this way we'll be able to keep track of the signups. We'll be able to follow up on them.")
- **The wizard asks for an email; Skip is allowed.** Skip only turns hosted Always on off (the rest of the app works as today).
- **Two kinds of mail, two lists:**
  | | Service mail | Marketing mail |
  |---|---|---|
  | What | the daily digest, trial-ending reminders, account mail (confirm, Pro receipt, sign-in codes) | tips and the Pro launch offer |
  | Opt-in | always allowed once an address is given | **separate and opt-in: an UNTICKED box** "Send me tips and the Pro launch offer (unsubscribe anytime)" (EU and Swiss rules forbid pre-ticking) |
  | Unsubscribe | one click, ends the daily searches' email (`service_mail_off_at`) | one click, `marketing_opt_in = 0` |
  Each email carries only its own list's links; a service mail never carries a promotion (§4b consent check).
- **No code step at signup.** The first digest carries a "confirm your email" link (`email_confirmed_at`). An unconfirmed address still gets the digest (the address is the person's own to type; a wrong one costs us one bounce and turns email off).
- **The email creates a trial account on the server,** in the same table as Pro accounts (`pro_accounts`, coordinated with job-pilotto-a6; migration 0080 adds `plan` ('trial'|'pro', default 'pro'), `email_confirmed_at`, `marketing_opt_in`, `marketing_opt_in_at`, `trial_started_at`, `service_mail_off_at`). A trial account never gets Pro treatment (the Pro lane needs `plan = 'pro'` and `status = 'active'`). A later purchase finds the account by the same email hash and flips `plan` to `pro`: **one click**, no second sign-up. The install is linked in `pro_devices` (raw install id, max 3 devices).
- **Signup metric:** `/admin` counts **trial accounts** (confirmed / unconfirmed / marketing opt-in / paused / converted) instead of counting installs. Installs without an email stay a separate "anonymous" number.
- **Data rule:** the address is stored once per person (hash for lookup, plain for sending), deleted with the account; hosted data deletion (§2) does not delete the account, "Delete my account" does.

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

## 6. Build plan (all behind `HOSTED_ALWAYS_ON=off`; **before the Pro launch** since 16 Oct 2026)
Hosted Always on for trial users needs the **trial budget, not payments** (owner, 16 Oct): it goes first. The Pro lane (compute debit from the credit, frequency choices) is added when Pro lands.
1. **Probe** (approved by the owner via cc, ≈ $0.01): one container run on a fixture profile; wall time, peak memory, egress, cold start. Replaces the §3 estimate (kept beside it).
2. **PR 1 (site):** D1 `hosted_schedules`, `hosted_runs`, `hosted_inbox`; run tokens (install-bound, no Pro account needed); routes to set/read schedule, post result; flag; tests (in-memory D1, fake clock).
3. **PR 2 (engine + image):** a `--hosted` entry that reads state from a directory, runs the SQLite-store search, AI via the run token; Dockerfile; contract test that the SQLite store round-trips through R2.
4. **PR 3 (site):** cron tick + Queue + container start; **compute debited from the trial budget** (the same `FREE_AI_TRIAL_USD` meter as Free AI; the Pro `pro_credit` debit comes with Pro) and counted in the global Free AI caps; per-install and global guards; kill switch; 14-day auto-pause; export and delete.
5. **PR 3c (site): the email sender** (Cloudflare Email Sending, moved up from Pro PR 5: Pro's device codes reuse it), digest email, one-click "stop daily searches" token, bounce handling.
6. **PR 4 (app):** onboarding switch (on) + disclosure line + email field, push config/CV, pull inbox and merge, Settings, sidebar, ⌘K, run card, "Get Pro to keep Always on running" pause text, before/after shots.
7. **Test on a twin/test install end to end;** owner flips `HOSTED_ALWAYS_ON=on` (after the cap decision in §3).
8. **With Pro:** `pro_credit` compute debit, frequency choices, pricing/privacy/terms lines, resume on purchase.

## Decided by the owner (16 Oct 2026, via job-pilotto-cc)
0. **Default-on for trial users** (see §4b), email in onboarding, 14-day auto-pause, hosted before the Pro launch (16 Oct, later).
1. **Frequency:** default **once a day**, choices up to **every 4 h** (the cap).
2. **Compute debit:** **$0.008 a run** (2x the measured $0.0039 on standard-1), as a Worker var re-set after the probe. Trial: once a day, from the $2 budget.
3. **v1 without Gmail, Telegram and Notion** (find, score, list only; we store no keys for them).
4. **Probe approved:** one container cost probe of about $0.01 on our Cloudflare account; stop if it heads past $0.10. Result: §3 "Measured".

## Progress
- [x] Owner model added: own resources unlimited, ours debited; trial users can try it (16 Oct, via job-pilotto-cc) (proof: none: decisions relayed by cc, see §0, §4b, §4c)
- [x] Spec read by the owner; questions 1-4 answered (proof: none: answers relayed by cc, see Decided above)
- [ ] Probe: container run measured, §3 estimate kept beside the measured numbers (proof: this file's §3)
- [ ] PR 1 (site): tables, install-bound tokens, routes, flag (proof: site/test/hosted-schedule.test.js)
- [ ] PR 2 (engine + image): `--hosted` entry, Dockerfile, R2 round-trip (proof: tests/test_hosted_run.py)
- [ ] PR 3 (site): cron tick, Queue, container start, trial-budget debit, global caps, 14-day auto-pause, guards, export and delete (proof: site/test/hosted-guards.test.js)
- [ ] PR 0 (site, job-pilotto-a6): migration 0080 trial columns on `pro_accounts`, `createAccount(..., {plan})` (proof: site/test/pro-credit.test.js)
- [ ] PR 3c (site): email sender, daily digest, one-click stop link, bounce handling (proof: site/test/hosted-notify.test.js)
- [ ] PR 4 (app): onboarding switch on + disclosure + email field, inbox merge, Settings, sidebar, ⌘K, run card, shots (proof: desktop/test/hosted-search.test.js)
- [x] Owner decides the Free AI monthly cap: stop $200, alert $100 (proof: none: decided by the owner via cc, 16 Oct; the wrangler.toml change is its own small site PR)
- [ ] Test end to end; owner flips `HOSTED_ALWAYS_ON=on`
- [ ] With Pro: `pro_credit` compute debit (`hosted-compute`), frequency choices, pricing/privacy/terms lines, resume on purchase
- [ ] Later: WhatsApp channel (Meta verification, templates, credit debit), after Pro launches
- [ ] Notion "⭐ Pro plan" updated to match (after the owner's yes)

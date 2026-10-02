# End-to-end tests

The **real** Job Pilotto app, driven by Playwright on a throwaway profile, in suites that each start from their own state and can run at the same time.

| Suite | Starts from | Covers | Time |
|---|---|---|---|
| `wizard` | an emptied Notion page | the first-run path: key, Notion workspace, CV, strategy, finish | ~2.5 min |
| `jobs` | a set-up install, its own jobs and runs reset | Actions, Recent activity, jobs check on fixture feeds, scoring, a **slow AI** (live log, no silence), Find employers, Focus/Jobs/Actions layout | ~4 min |
| `interviews` | a set-up install, its own interview and job rows reset | the library on dummy Notion rows (order, outcomes, search, filter, open, link/unlink, delete), the recorder's consent rule, a transcript **imported through the page and reviewed for real**, a **failing AI** (clear message, no half-written row), review again (guard and replace), insights | ~4 min |
| `calendar` | a set-up install, its own job and interview rows reset | meetings from the Job Tracker and from recordings on the month grid, a busy day, the agenda, month arrows, opening a job, **two time zones** (Tokyo, Honolulu) | ~3 min |
| `settings` | a set-up install | every Settings section, the AI engine panel with each engine chosen | ~30 s |
| `personas` (**manual**) | a set-up install | two fictional users (a data analyst in Austin, a marketing manager in São Paulo) run one after the other: nothing Swiss or EU in the UI, digest or Notion; the visa flag follows citizenship and places; their search regions, Google Jobs places and currencies | ~15 min |
| `employers` | a set-up install, its own employer rows and runs reset | Find new employers on a candidate list of every kind (good board, empty, wrong roles, dead feed, duplicate, excluded, manual watch): statuses, quality order, Employers & Sources rows, the run row's counts, a second run, the crawl's source list, a Sonnet judge | ~1 min |
| `focus` | a set-up install + dummy applications in every stage written to Notion | Up next order and buttons, every number checked against the Notion rows (`lib/focus-data.mjs`), Edit target, Done/Skip, Insight, a fresh account | ~3 min |
| `apply` | a set-up install + 4 kit jobs it writes | the real **Chrome extension** on fixture forms: Apply click → fill from the kit, CV, legal boxes left, AI answers highlighted, late field, multi-step, unknown widget, Submit never touched | ~3 min |
| `activity` | a set-up install, its own run rows reset, schedule off | every task on Actions (one row, an end, plain words, a log without keys/emails/paths, no Notion row left Running) and the Recent activity screen: the filter, "View all activity", a finished run's result card, a run read only from Notion | ~4 min |
| `activityfailures` | the same, on its own Notion page, in parallel | what goes **wrong**: the AI answering **429, 500, 401, no credit** and **never answering** (`lib/ai-proxy.mjs` modes), a spend-limit pause, a double click, a Gmail check queued behind a search, **quitting mid-run**. Shared steps: `lib/activity-steps.mjs` | ~5 min |
| `quality` (**nightly**) | a set-up install, a known compensation target written into its Profile | whether the Jobs check's output is *right*: 11 golden postings with a known truth (`fixtures/golden/`): facts exact, a duplicate collapsed, ranking, scores stable (±8, one job in nine may stray), no `undefined`/raw JSON in any text, no job text in the logs, and a Sonnet judge (`lib/factjudge.mjs`) for invented facts in the score reasons (one text in nine may slip: model noise has an allowance, facts, duplicates, ranking and leaks have none) | ~3 min, ~$0.3 (the app runs on Sonnet; `E2E_APP_MODEL=claude-haiku-4-5` for a cheap run) |
| `strategy` | a set-up install, its own jobs reset, two small fixture boards | a change to the roles, places or companies to skip reaches ⚙️ Search settings (Notion), `config/search.json` and the next Jobs check, whether it was made in the app or on the Notion page; accepting a strategy change keeps what was edited on the page meanwhile; a reconnected app keeps the real settings and the same page | ~6 min (estimate) |

## When each suite runs (cadence)
A suite exports `cadence` (`lib/plan.mjs` decides, `plan-run.mjs` plans the CI run):
- `always` (the default): every automatic run, including the three-a-day schedule.
- `nightly`: the nightly release gate, and a push that touches the suite's files or its `watches` (the paths it judges). `quality` is this: it costs about $0.3 a run.
- `manual`: never by itself; a person names it (`gh workflow run e2e.yml -f suite=personas`, `npm run all -- --only personas`). `personas` is this: kept, not deleted.

The paid AI-judge steps (`employers`) also run only in the nightly gate and in manual runs (`E2E_FULL=1`); on a Mac they always run.

## Running them all on this Mac
`npm run all` runs every suite that is not manual, one after the other, and prints one table. `-- --only jobs,quality` runs exactly those (even a manual one), `-- --skip wizard` leaves some out,
`-- --manual` adds the manual ones, `-- --parallel 3` runs three at a time (each suite then needs its own Notion token). Secrets come from the environment, else from the Keychain
(`job-pilotto.e2e.anthropic_key`, `.notion_token`, `.notion_token_<suite>`).

```
cd desktop/e2e && npm install
node suite.mjs settings            # one suite, about half a minute (npm run settings)
node suite.mjs wizard              # or jobs, interviews, focus
E2E_ANTHROPIC_KEY=sk-ant-… E2E_NOTION_TOKEN=ntn_… node suite.mjs settings
```

## How a suite gets its state
- **Each suite has its own Notion test page and connection**, so suites never touch each other's data: `E2E_NOTION_TOKEN` (wizard), `E2E_NOTION_TOKEN_JOBS`, `E2E_NOTION_TOKEN_INTERVIEWS`, `E2E_NOTION_TOKEN_CALENDAR`, `E2E_NOTION_TOKEN_SETTINGS`, `E2E_NOTION_TOKEN_FOCUS`, `E2E_NOTION_TOKEN_EMPLOYERS`, `E2E_NOTION_TOKEN_PERSONAS`, `E2E_NOTION_TOKEN_APPLY`, `E2E_NOTION_TOKEN_ACTIVITY`, `E2E_NOTION_TOKEN_STRATEGY`. A suite without its token is skipped in CI; on a Mac it falls back to the wizard's token (one suite at a time).
- **The workspace is built once and kept.** The wizard suite empties its page and builds it from scratch every run. The others find their page already built and **seed the app in about 5 seconds** with the app's own calls (`saveSecret`, `notionConnect`, `saveSettings`), not the wizard. A suite whose page is empty builds it once with the real wizard path (`lib/wizard.mjs`).
- **A suite resets only its own data** (the jobs suite empties its job rows and run rows), never the workspace.
- Dummy data without an AI call: `lib/notion.mjs` (`createRow`, `rows`, `pageBlocks`) and `lib/interview-data.mjs` (row builders and the pure checks, tested in `test/`). `lib/steps.mjs`: independent steps (one failure never hides the others), captured external links, answered `confirm()`. A suite can export `env` (e.g. `TZ`) for its app, and the AI proxy has `setMode(...)` for a failing AI (`no-credit`, `server-error`, …).
- Files: `suite.mjs` the runner · `suites/*.mjs` the steps · `lib/context.mjs` secrets, Notion guard, feeds, proxy, launch · `lib/seed.mjs` the fast seed · `lib/wizard.mjs` the real first-run path · `lib/layout.mjs` screenshots + checks · `lib/activity.mjs` + `lib/ai-proxy.mjs` the slow-AI scenario.

## Adding a suite (a file, nothing else to edit)
1. Create `suites/<name>.mjs`: `export const name = '<name>'; export const minutes = 15; export async function run(ctx) { … }`. The CI matrix is built from the files in `suites/` (`node suite.mjs --list`).
2. Start with `await ensureSetUp(ctx)` (from `lib/seed.mjs`) for a set-up install in seconds, then `ctx.run('what a person can now do', async () => {…}, {needs: ctx.needs})` per step; `snap`/`visit`/`finish` from `lib/layout.mjs` for screenshots and layout checks.
3. A suite that writes to Notion needs **its own Notion test page and connection** (suites share nothing): add `E2E_NOTION_TOKEN_<NAME>: ${{ secrets.E2E_NOTION_TOKEN_<NAME> }}` to the `env:` block of `.github/workflows/e2e.yml` and the secret to GitHub. Without the token the suite is skipped in CI and falls back to the wizard's page on a Mac.
4. Reset only your own data, keep the isolation rules below, put dummy data in through the Notion API (`lib/notion.mjs`) rather than the AI where you can.

## The employers suite
- Fixtures: `fixtures/feeds/employers/` (the boards, `scout_seeds.json`, `person.json` = the fictional SRE in Zurich the scout judges for, via `JOB_PILOTTO_LOCATIONS_FILE`, so the test workspace's own search settings cannot change the outcome). A suite may export `env` for the app.
- The expected outcomes are also proven without the app or Notion in `tests/test_e2e_employers_fixtures.py` (seconds).
- `lib/judge.mjs`: a Sonnet judge (no `temperature`) that says per added employer whether it suits the person; a missing or unreadable verdict is a failure, never a pass. `lib/employers.mjs` holds the pure row/run-line checks, tested in `test/employers.test.mjs`.
- It empties only the Employers & Sources and run rows of its own page. Never run it on the wizard page while another suite uses that page (the fallback is for one suite at a time).

## What is real, what is faked
| Part | How |
|---|---|
| Wizard, settings, CV upload | the real UI; the native file dialog is replaced (`pickFile`) |
| Notion | real, in a **dedicated test workspace**: an empty page "Job Pilotto E2E" and a connection that sees only it |
| AI | real, Haiku for every step (cheap: about $0.25–0.40 a run) |
| Jobs and employers | local fixture feeds (live feeds change daily and would make the test flaky) |
| Gmail | skipped (a mock of the Google endpoints may come later) |
| Apply | the real extension on a local fixture form; Submit must never be clicked |

## Using your own CV locally
`E2E_CV=/path/to/cv.pdf node suite.mjs wizard` uses a real CV for a local run. It is only read from that path and sent to the test Anthropic key and the test Notion page; it is never copied into the repo (public). CI always uses `fixtures/cv.pdf`.

## Secrets
- `E2E_ANTHROPIC_KEY`: a dedicated Anthropic key with a small monthly spend limit.
- `E2E_NOTION_TOKEN`: the test connection's token. Never use your own Notion.
Both live in GitHub (Settings → Secrets → Actions) and, for local runs, in the macOS Keychain
(`job-pilotto.e2e.anthropic_key`, `job-pilotto.e2e.notion_token`). Never in code.

## Files
`lib/app.mjs` launch, close, file picker · `fixtures/cv.pdf` a fictional CV (`make-cv.py` rewrites it)

## What the test app reports (the rule: it never alters live data)
| Channel | In the journey |
|---|---|
| Your telemetry store (`/telemetry`: machines, crashes, runs) | **off**, always |
| PostHog (the usage funnel) | **off**, always |
| Sentry | **off locally; on in CI**, tagged `environment: e2e`, one fixed anonymous id `e2e` |
| Employer pool sharing, the app's recipe/alias reports | **off** (the test profile is seeded with `telemetry: false, shareEmployers: false`) |

`launch()` sets `JOB_PILOTTO_E2E=1`, and refuses to run unless the app says in its own log `reporting is off: the end-to-end journey`. The last
journey step checks that nothing was queued to send. (2 Oct 2026: before this, test profiles passed `JOB_PILOTTO_TELEMETRY=0`, which the app read as
"on", and nine test runs counted as machines on `/telemetry`.)

## The apply suite (the real extension, fixture forms)
- **Browser:** Playwright's Chromium loads a *copy* of `extension/` whose built-in app address (`127.0.0.1:47111`) is rewritten to a free port (`lib/extension.mjs`
  `copyExtension`); the app under test listens there (`JOB_PILOTTO_PORT`). So it runs next to your own Job Pilotto and can never pair with it. CI: `npx playwright-core install chromium`.
- **Forms:** `lib/forms.mjs` serves them over HTTPS; Chromium maps `boards.greenhouse.io`, `jobs.lever.co`, `e2e.recruitee.com` to that server and every other host name
  is unresolvable (the suite asserts no other host was asked for). Each form logs a click or submit event on Submit; any is a failure.
- **Apply click:** the app runs `open -a "Google Chrome" <url>`; a stand-in `open` first on the app's PATH hands the URL to that Chromium. macOS only.
- **AI:** the app's own AI calls go to the test proxy (`JOB_PILOTTO_E2E_AI_BASE_URL`, honoured by `lib/ai-trial.js` in a test run), which answers the one open question with a fixed text: no cost.
- **Judgements** are pure functions (`lib/applycheck.mjs`), each tested against a wrong input (`test/applycheck.test.mjs`). `E2E_LATE_MS=40000` renders the Lever field too late: that step must fail.
- **Found by this suite (2 Oct 2026), fixed in `extension/review.js`:** the panel counted native fields only, so a required custom widget it could not read left "Ready to submit" on screen. It now lists it as left for you until its own state changes (`worker/test/panel-widgets.test.js`); the last step guards it.

## Activity suite: what it relies on
- **Failure modes:** `proxy.setMode('rate-limit' | 'server-error' | 'invalid-key' | 'no-credit' | 'hang' | 'pass')` answers the engine's AI calls the way the real API does (bodies in `FAILURES`, unit-tested in `test/ai-proxy.test.mjs`). `JOB_PILOTTO_E2E_IDLE_MS` (honoured only with `JOB_PILOTTO_E2E`) shortens the app's 15-minute silence limit so a hung AI is tested in under a minute.
- **`ctx.relaunch(env, between)`** kills the app the hard way (a crash or power cut) and starts it again on the same profile; `between(profile)` runs while it is down.
- **Words and leaks:** `badSummary()` and `leaks()` in `lib/activity.mjs` (unit-tested) judge a run's summary line and log: empty / `undefined` / raw JSON / stack trace, and any key, token, email or home path.
- **Fresh posting ids every run** (`setFeed`): a posting an earlier run saw has a Job Matches row in Notion and is not new. The postings' titles mention both "Site Reliability Engineer" and "Data Analyst", so they match whatever the page's Search settings are.
- **A Mac shares one page between suites** that have no token of their own; another session rebuilding it mid-run breaks the run ("database not found"). Use `E2E_NOTION_TOKEN_ACTIVITY` (Keychain `job-pilotto.e2e.notion_token_activity`).
- **Isolation:** with `JOB_PILOTTO_E2E` the engine ignores this Mac's Keychain (`src/secret_store.py`); before that, a test "Gmail check" read the owner's real mail (2 Oct 2026).

## What CI runs, and when (the test key's AI credit is shared, so this is deliberate)
- **After the nightly build (04:00 Zurich):** every suite on the build's commit; all green → the `promote` job makes the build stable (RELEASE.md). **Three scheduled runs a day on main (09:47, 13:47, 17:47 UTC):** every suite, skipped when main has not changed since the last run and no finding waits for a second sighting; the AI screenshot review runs only when `desktop/renderer`/`desktop/e2e` changed or a finding waits. All of it is decided in `plan-run.mjs`. **A manual run:** every suite. A manual run may name some: `gh workflow run e2e.yml -f suite=jobs,activity`.
- **A push to `main`:** only the suites whose files changed (`lib/plan.mjs`): `suites/<name>.mjs` runs `<name>`; `extension/**` runs `apply`; other shared test code
  (`lib/`, `suite.mjs`, fixtures, `e2e.yml`) runs `settings` as an AI-free smoke test; the tests' own unit tests (`npm test`) and docs run no suite. The plan job runs
  `npm test` every time (no secrets, no AI).
- The UI-heal loop only follows scheduled and manual runs, never a push.

## Why `activity` is two suites
One suite took about 10 minutes, the slowest by far (the others 1 to 4). It is split into two that run at the same time, each on its own Notion page, and the waits were cut:
the app's history poll (`JOB_PILOTTO_E2E_HISTORY_MS`), its resume wait (`JOB_PILOTTO_E2E_RESUME_MS`) and the watchdog's silence limit (`JOB_PILOTTO_E2E_IDLE_MS`) are shortened in the journey only
(`desktop/lib/e2e-timing.js`), and the AI proxy's refusals ask for an immediate retry.

## What the UI loop's issues carry
`desktop/e2e/triage.mjs` (the step of `ui-findings.yml`, the producer, after every e2e run) reads every suite's artifacts and files one issue per problem. An issue has:
- **Severity, kind, view, suite and source as labels** (`severity:high`, `kind:layout`, `view:focus`, `suite:activity`, `source:ai-review`), so the issue list can be filtered.
- **The screenshot** (uploaded to a tag `ui-evidence-<run>` under `ui-loop/<fingerprint>/`, an image link that outlives the Actions artifact; a tag, not a branch, so GitHub shows no "recent pushes" banner), **the app's state** at that moment as a table, **where to look**
  in the code, **how to reproduce** (`node suite.mjs <suite>`), and, for a failed step, the step's message, its failure screenshot and the last lines of the app's and the engine's logs.
- **Repeats are recognised even when the AI words them differently** (same view and kind, alike words): the issue gets a "Seen again in run …" comment with that run's screenshot.
- **"Not seen in run …"** when the page was photographed and reviewed again and the finding did not come back, with the new screenshot (also on the open fix pull request: its "after"), and the label `not-seen-latest`.
- **`confirmed`** (a label a person adds): a finding that is real is ready for a fix without a second sighting. `wontfix-auto` closes a false positive for good; `needs-human` parks one.
A fix pull request shows the finding's screenshot as "Before" and promises the "After" when a later run no longer sees it.

## The loop is two workflows on two clocks
- **`ui-findings.yml` (the producer), after every e2e run: four a day** (the run chained to the nightly build, and 09:47, 13:47, 17:47 UTC). It only files and updates issues, with the evidence above. No AI fix.
- **`ui-fix.yml` (the fixer), once a day at 05:30 UTC (07:30 Zurich in summer).** `pick.mjs` chooses the most critical finding that is ready: **score = severity (high 3, medium 2, low 1) times its
  sightings in the last 7 days, doubled by `confirmed`**; two sightings this week, or `confirmed`, are needed; only kinds a UI change can fix. Claude Code (Sonnet 5, at most 50 turns, about
  $0.5 to $1.5 an attempt) fixes it in `desktop/renderer` with a test first; a guard and the desktop suite must pass; ONE pull request opens, with the finding's screenshot as "Before". At most 3 are open at once.
  By hand: `gh workflow run ui-fix.yml`.
Between the two a person can add `confirmed` or `wontfix-auto` to an issue: the fixer works on a curated list.

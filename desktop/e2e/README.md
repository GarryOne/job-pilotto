# End-to-end tests

The **real** Job Pilotto app, driven by Playwright on a throwaway profile, in five suites that each start from their own state and can run at the same time.

| Suite | Starts from | Covers | Time |
|---|---|---|---|
| `wizard` | an emptied Notion page | the first-run path: key, Notion workspace, CV, strategy, finish | ~2.5 min |
| `jobs` | a set-up install, its own jobs and runs reset | Actions, Recent activity, jobs check on fixture feeds, scoring, a **slow AI** (live log, no silence), Find employers, Focus/Jobs/Actions layout | ~4 min |
| `interviews` | a set-up install | Interviews and Calendar pages | ~30 s |
| `settings` | a set-up install | every Settings section, the AI engine panel with each engine chosen | ~30 s |
| `personas` | a set-up install | two fictional users (a data analyst in Austin, a marketing manager in São Paulo) run one after the other: nothing Swiss or EU in the UI, digest or Notion; the visa flag follows citizenship and places; their search regions, Google Jobs places and currencies | ~15 min |

```
cd desktop/e2e && npm install
node suite.mjs settings            # one suite, about half a minute (npm run settings)
node suite.mjs wizard              # or jobs, interviews
E2E_ANTHROPIC_KEY=sk-ant-… E2E_NOTION_TOKEN=ntn_… node suite.mjs settings
```

## How a suite gets its state
- **Each suite has its own Notion test page and connection**, so suites never touch each other's data: `E2E_NOTION_TOKEN` (wizard), `E2E_NOTION_TOKEN_JOBS`, `E2E_NOTION_TOKEN_INTERVIEWS`, `E2E_NOTION_TOKEN_SETTINGS`, `E2E_NOTION_TOKEN_PERSONAS`. A suite without its token is skipped in CI; on a Mac it falls back to the wizard's token (one suite at a time).
- **The workspace is built once and kept.** The wizard suite empties its page and builds it from scratch every run. The others find their page already built and **seed the app in about 5 seconds** with the app's own calls (`saveSecret`, `notionConnect`, `saveSettings`), not the wizard. A suite whose page is empty builds it once with the real wizard path (`lib/wizard.mjs`).
- **A suite resets only its own data** (the jobs suite empties its job rows and run rows), never the workspace.
- Files: `suite.mjs` the runner · `suites/*.mjs` the steps · `lib/context.mjs` secrets, Notion guard, feeds, proxy, launch · `lib/seed.mjs` the fast seed · `lib/wizard.mjs` the real first-run path · `lib/layout.mjs` screenshots + checks · `lib/activity.mjs` + `lib/ai-proxy.mjs` the slow-AI scenario.

## Adding a suite (a file, nothing else to edit)
1. Create `suites/<name>.mjs`: `export const name = '<name>'; export const minutes = 15; export async function run(ctx) { … }`. The CI matrix is built from the files in `suites/` (`node suite.mjs --list`).
2. Start with `await ensureSetUp(ctx)` (from `lib/seed.mjs`) for a set-up install in seconds, then `ctx.run('what a person can now do', async () => {…}, {needs: ctx.needs})` per step; `snap`/`visit`/`finish` from `lib/layout.mjs` for screenshots and layout checks.
3. A suite that writes to Notion needs **its own Notion test page and connection** (suites share nothing): add `E2E_NOTION_TOKEN_<NAME>: ${{ secrets.E2E_NOTION_TOKEN_<NAME> }}` to the `env:` block of `.github/workflows/e2e.yml` and the secret to GitHub. Without the token the suite is skipped in CI and falls back to the wizard's page on a Mac.
4. Reset only your own data, keep the isolation rules below, put dummy data in through the Notion API (`lib/notion.mjs`) rather than the AI where you can.

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

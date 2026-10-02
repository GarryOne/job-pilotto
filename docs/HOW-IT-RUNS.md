# How Job Pilotto runs itself

> **Read this first in a new session.** What runs on its own, when, what it may change, and where the owner
> approves. Every workflow in `.github/workflows/` must be listed here (`tests/test_how_it_runs.py` fails otherwise).
> The prompts of the product brain and the self-review are private (repo `GarryOne/job-pilotto-internal`, synced into secrets).

## 🧭 Strategy
Private: the owner's **📍 Product Compass** and **💰 IP & Monetization** in Notion (🧭 Strategy). Hard rules that shape
the code: never auto-apply or press Submit; never scrape LinkedIn, Glassdoor, levels.fyi or Reddit; ask before spending
money on AI; every manual fix becomes an app step (CLAUDE.md → Working rules).

## 🔁 How the loops connect

```mermaid
flowchart LR
  apps[Users' apps] -- scrubbed reports --> tel[/telemetry + /api/signals/]
  apps -- form structure --> lab[form lab: private repo] -- recipes --> apps
  tel -- recurring problems --> triage[triage: private repo] --> issues[(private issues)]
  issues -- owner fixes by hand or PR --> main[(main)]
  main --> ci[build: tests] & desktop[desktop: pre-release] & site[site: deploy]
  desktop --> canary[canary-promote: 48 h healthy] --> stable[stable release] --> apps
  main -. weekly facts .-> review[weekly-self-review: rules PR]
  tel & issues & main --> brain[product-brain: ONE action a day] -- owner taps --> plan[plan in Notion]
```

## ⚙️ Every automatic loop

| Loop | Trigger | Does | May change | Output | ✋ Owner gate |
|---|---|---|---|---|---|
| `build.yml` · CI · Tests | push / PR to main | Python, worker, desktop suites | nothing | red/green | — |
| `desktop.yml` · Release · Desktop app | push touching the app | builds Mac + Windows, signs, provenance, pre-release; prunes to 3 test builds; rebuilds main if workflows changed mid-build | releases | GitHub pre-release | promote (or canary) |
| `windows-smoke.yml` · CI · Windows smoke | weekly (Mondays 06:17 UTC) | builds the Windows app from main and installs it on a fresh runner, with no release: runner or bundled-native drift shows up in a quiet week | main | screenshots (artifact) | — |
| `e2e.yml` · CI · End-to-end journey | by hand, **twice a day** (05:47 and 17:47 UTC), and on pushes to desktop/e2e or the extension (only the suites whose files changed) | four suites in parallel (wizard, jobs, interviews, settings), each from its own state in its own Notion test page, driving the real app on a Mac: the first-run path, Actions and Recent activity with a slow AI, Interviews, every Settings section | main | screenshots per suite (artifacts) | — |
| `ui-heal.yml` · CI · UI self-healing loop | after each scheduled e2e run (so twice a day), or by hand | files what the journey's layout checks and AI screenshot review found as issues (one per problem); when one was seen in two runs, Claude Code fixes it and opens ONE pull request (at most 3 open) | main (a branch `auto-fix/<id>`) | the pull request, issues labelled `auto-ui` | owner merges the PR; nothing merges itself |
| `canary-promote.yml` · Canary | daily 09:17 UTC | promotes a pre-release 48 h old, green, used and healthy | the Latest release | stable → apps offer "Update to …" | variable `JOB_PILOTTO_AUTO_PROMOTE=on` |
| `site.yml` · Release · Website | push touching `site/` | deploys the website worker | the live site | jobpilotto.workers.dev | — |
| Form lab · private repo `GarryOne/job-pilotto-internal` (`form-lab.yml`, daily 04:17 UTC) | headless browser on public application forms with a test applicant (never submits), aimed by the site's plan → success per board and control; tries candidate recipes | the site's recipe and lab tables (`/api/lab`, `/api/recipes`) | a recipe gets a 5% canary when it works on enough pages | disable any recipe on the site |
| Triage · private repo `GarryOne/job-pilotto-internal` (`triage.yml`, daily 05:47 UTC) | pulls recurring problems from the site's queue (several installs, or very often) → one issue per problem in the private repo | issues (private) | `telemetry` / `fill-failure` issues there | act on the issue |
| `weekly-self-review.yml` | Sunday 18:00 UTC | reads the week's rework → ≤ 3 rule/skill edits | CLAUDE.md, AGENTS.md, skills (PR) | `self-review/<date>` PR | merge the PR |
| `product-brain.yml` · Product brain | daily 05:00 UTC; Sunday 16:00 strategy review | reads the owner's 📍 Product Compass, numbers, the website (screenshots), GitHub → ONE action serving the phase; Sunday: proposes Compass changes (Opus, web) | Notion Decisions (+ Compass on ✅) | Brain bot card | ✅ Explore, ✅ Approve, ✅ Update the compass |
| `daily.yml` · Find new jobs | user's private repo (every 4 h) | crawl, score, digest, kits | the user's Notion | Telegram digest | user submits |
| `scout.yml` · Find new employers | user's private repo, **optional** (off for new installs) | probes public job-feed APIs | the user's employer list | Telegram | — |
| `central-scout.yml` · Central scout | private repo `GarryOne/job-pilotto-internal` (daily) | runs the public engine's scout with no user data, verifies every feed, uploads the index to the website (`PUT /api/index`, secret `INDEX_PUBLISH_KEY`) | the shared employer index (KV) | apps and Always-on runs download it (worldwide feeds with the places they hire in; each install crawls only feeds with roles in *its own* `search.json` places, `JOB_PILOTTO_INDEX_ALL=1` for all): `GET /api/index`, at most daily, cached, merged with the starter `config/sources.json`; API down → cache/starter, a run never fails | — |
| `mail.yml` · Gmail and Calendar | user's private repo (3× a day) | read-only mail → application events | the user's Notion | Telegram | — |

**Employer index (Stage 1, step E):** the index is product data on our service (Cloudflare KV, `site/src/employers.js`), not
in anyone's Notion; nothing of the user goes up (a plain GET). Clients: `src/employer_index.py`. The owner's Notion
Employers & Sources keeps working on top of it.

**In the app (every user):** Notion schema repair at start (`desktop/lib/schema.js`), data migrations (`migrate.js`),
weekly backup (`backup.js`), update check at start + every 6 h (`updater.js`), technical reports (`telemetry.js`,
off in Settings; never from `npm start`).

**For sessions (local):** `tools/pre-push-check.sh` blocks a push unless all suites + actionlint pass;
`tools/stop-test-check.sh` runs the touched suites before "done"; `CODEMAP.md` is kept fresh by a test.

## 🗂️ Where things live
- **Code map:** `CODEMAP.md` · **change loop:** CONTRIBUTING.md · **releases:** RELEASE.md · **rules:** CLAUDE.md
- **Notion (product):** Project Hub → Session Handoff (current state), Run Log, Decision Log, 🧭 Product Brain · Decisions
- **Numbers:** `/stats` (website), `/telemetry` (apps), `/api/signals` (both, JSON; the /stats key)

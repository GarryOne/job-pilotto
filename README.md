# SRE Watch — first increment

Collect direct Greenhouse postings from Cloudflare, Grafana Labs and Canonical.
Python 3.10+; no dependencies, subscriptions or API keys required.

```sh
python3 /Users/mac/sre-watch/watch.py
```

Open `reports/latest.html` in a browser. Use its filter to search locations,
companies and titles. JSON output is available for a future Telegram adapter.
Each run also creates timestamped reports. SQLite in `data/` remembers job IDs.

New means first seen locally, not recently published. Changed means the title,
location or application URL changed. Description changes are not checked yet.
Results are worldwide; no work authorization, language, seniority or remote
eligibility is inferred. No AI scoring is used in this increment.

One source failing does not prevent the other results being saved. The report
shows failures and the process returns exit code 1 if any source fails. Jobs
missing from a source are omitted from that run, not declared permanently closed.

Run verification: `python3 -m unittest discover -s /Users/mac/sre-watch/tests`

Next increments:
1. Confirm locations and role preferences; refine filtering.
2. Run `python3 /Users/mac/sre-watch/daily.py` to preview a canonical digest.
The daily command imports the direct employer feeds and, when present,
`reports/companies.json` from the Swiss company-discovery run. Direct feeds are
global unless a posting states a Swiss location; the digest keeps that evidence
visible instead of pretending global remote means Swiss eligibility.

3. Create a private Telegram bot, set `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_CHAT_ID`, then run `python3 /Users/mac/sre-watch/daily.py --send`.
4. Add Telegram Save/Dismiss commands and persistent preferences.
5. Deploy with daily scheduling and failure notifications.
6. Add AI explanations and ranking, with a usage budget.

Telegram setup when ready: create a bot with https://t.me/BotFather using
`/newbot`, then open the new bot and press Start. Store its token in local or
hosting secrets; do not commit it. No bot or schedule is configured yet.

Source API documentation: https://docs.greenhouse.io/job-board.html

## Swiss company discovery

```sh
python3 /Users/mac/sre-watch/discover.py --pages 2 --max-companies 80
```

Open `reports/companies.html`: filter by city, company, job title, Remote or
Hybrid. CSV and JSON companions contain evidence links and discovered career
pages / ATS links. Company size comes from the board profile, not an estimate.
The crawler searches software engineer, site reliability and développeur
logiciel on jobs.ch, with bounded pagination. `--pages 2` expands the search.
`--max-companies` caps enrichment, with discovered/enriched counts reported.
It also checks SwissDevJobs and TechTree; blocked requests and unsupported
formats appear in the report. It does not bypass access restrictions.

jobs.ch jobs must have an explicit Swiss country in structured location data;
expired jobs are excluded when a deadline is provided. TechTree uses visible
Swiss-city labels; anonymous employer names can remain unresolved. Global
remote jobs without Swiss location evidence are not included. No AI or search
API key is needed. No LinkedIn crawling is performed.

Company websites are followed from board-provided links, then up to three
career candidates are fetched; linked ATS hosts are detected. This is evidence
of a reachable careers link, not proof that the board vacancy still appears on
the official site. Domain names are never invented. Consulting/recruiting firms
are included and labelled by their actual advertiser names; end clients may be
undisclosed. Company size is not a hard exclusion criterion.

Remote/hybrid labels are extracted from posting text, not inferred from city.
“Remote mentioned” is a review flag, not proof of full remote eligibility.
The tool does not estimate applicant competition. Dates are source dates when
provided, not a claim that a listing is newly published.

Network requests time out after 15 seconds; three company workers run with a
short delay per request. Successful responses are cached for six hours. Use
`--refresh` to fetch again. Reports show the latest scan; the cache is not an
application tracker. Daily hosting and Telegram remain separate next steps.

## GitHub Actions

The repository includes `.github/workflows/daily.yml`. It runs the tests,
discovers Swiss software employers and generates a digest every four hours
(00:30, 04:30, 08:30, 12:30, 16:30 and 20:30 UTC). Run it manually with the
workflow-dispatch button after pushing.

Each digest lists up to 25 jobs: new jobs first, then "more to explore" from
older open jobs. Both sections rank Swiss locations first, then SRE-type titles,
then remote/hybrid; equally ranked jobs are shuffled so repeat digests vary.
Long digests are split into several Telegram messages.

Between runs the workflow keeps `data/canonical.sqlite` and `data/jobs.sqlite`
in the GitHub Actions cache, so each digest lists only jobs first seen in that
run, and `--send` skips Telegram when there are none. If GitHub evicts the cache,
the next run starts fresh and sends one repeated digest.

Without secrets, the workflow uploads a report artifact and prints a preview.
To send the digest to Telegram, add repository secrets named
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Secrets are optional and never
belong in the repository. The workflow uses GitHub-hosted Ubuntu runners and
does not require a server that stays online.

On macOS, `daily.py --send` also reads the optional Keychain entry named
`sre-watch.telegram.bot-token` when `TELEGRAM_BOT_TOKEN` is not set. The
Keychain is local only; GitHub Actions still requires the repository secret.

## Telegram commands and application tracking

`worker/` is a Cloudflare Worker that receives the bot's Telegram webhook.
`/help`, `/status` and `/applied` are answered by the Worker directly; `/run`,
`/today` and `/apply_<code>` start this workflow, which replies when done.

Applications live in the Notion database "Applications — Job Tracker", not in
SQLite: they can't be re-crawled if the Actions cache is evicted. Tapping
`/apply_<code>` under a digest job creates its Notion row (Stage = Applied).
Every digest hides jobs whose URL has a Notion row in any stage except Saved.
Update stages, confirmation emails and interview dates in Notion.

One-time setup:

1. Create a Notion internal integration, copy its token, and connect it to the
   Applications database (••• → Connections).
2. Create a fine-grained GitHub token for `GarryOne/sre-watch` with
   Actions: read and write.
3. Run `npx wrangler@4 login`, then `worker/setup.sh`. The script prompts for
   both tokens once (saving them in the Keychain), deploys the Worker, stores its
   secrets and `NOTION_TOKEN` for Actions, and sets the Telegram webhook.

Worker tests: `cd worker && npm test`.

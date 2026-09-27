# Scheduled runs in your own private repo

These three files are what keeps Job Pilotto searching while your Mac is off. They live in a
**private** repository of yours (the Desktop App creates it and copies them to
`.github/workflows/`), and each one calls the matching workflow in this public repo, which runs
the code with *your* repository's secrets and variables. Your logs, job database and results
never touch the public repo, and every fix released here reaches your runs automatically.

| File | When (UTC) | What |
|---|---|---|
| `daily.yml` | every 4 hours | crawl, score, Telegram digest, Notion sync; also started by the bot's buttons |
| `scout.yml` | 06:15 | finds new employer job feeds |
| `mail.yml` | 05:00, 10:00, 16:00 | Gmail + Calendar → Notion and Telegram (read-only) |

Your private repo needs:
- **Secrets:** `ANTHROPIC_API_KEY`, `NOTION_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and
  optionally `SERPAPI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.
- **Variables:** your Notion IDs (`NOTION_APPLICATIONS_DB`, `NOTION_MATCHES_DB`, … — see
  `.env.example`), and the feature switches you use (`JOB_PILOTTO_SCORE_MODEL`, …).

By hand: create a private repo, copy these files into `.github/workflows/`, then add the secrets
and variables in its Settings → Secrets and variables → Actions.

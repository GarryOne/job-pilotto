# Live test: a twin of the owner's app

> **Verdict:** to see a fix work on the owner's real state and real websites, run `cd desktop && npm run twin`.
> A second app (its own window, port and browser) on a fresh copy of the real app folder, with Notion replaced by a one-way mirror.
> Nothing it does reaches the owner's app window, Chrome windows, Telegram or real Notion. Never Submit. (Owner, 8 Oct 2026.)

| | Owner's app | Twin |
|---|---|---|
| Folder | `~/Library/Application Support/Job Pilotto` | `…/Job Pilotto (live test)/home`: a fresh clone at each start |
| Notion | "Job Pilotto - mac - Photographer" | "🧪 Job Pilotto – Live Test" (one-way mirror, synced at each start) |
| Token | Keychain `job-pilotto.notion.token-desktop-real` | Keychain `job-pilotto.notion.token-live-test` (404 on every real database: checked at start) |
| Browser | the owner's Chrome | its own visible Chromium window (profile kept), extension copy on the twin's port |
| Port | 47111 | a free one (`twin.json`) |
| Telegram, schedules, Always on, telemetry | on | off (`desktop/lib/twin.js`) |
| AppleScript on Chrome / Terminal, Apply with Claude | yes | off |
| Engine's Keychain (Telegram bot, Google sign-in) | yes | none (`src/secret_store.py` `isolated()`) |
| Real websites, Keychain site passwords, AI | yes | yes (real AI spend: say the cost) |

## Run it
- `cd desktop && npm run twin` (or `--no-sync` to skip the sync). Ctrl-C stops the app and its browser.
- Drive it from `~/Library/Application Support/Job Pilotto (live test)/twin.json` (Playwright `connectOverCDP`):
  `cdp` is the twin app's window (call `window.pilot.*`), `browser` is its Chromium (read a tab, click a control; never Submit).
- Its browser profile is kept in `…/Job Pilotto (live test)/browser/` (site sign-ins survive); its extension copy has "all sites" access built in,
  as granted once in the owner's Chrome.
- Its log: `…/Job Pilotto (live test)/home/logs/app.log`. The owner's `app.log` must show none of its lines.

## Rules
- Never the owner's main app window or process; never Submit; nothing destructive anywhere.
- DOM reads are narrow: never read a password field's value.
- Notion writes only ever reach the mirror. The mirror is overwritten at each sync: never edit it, never the source of anything.

<details><summary>Setting the mirror up again (once per workspace)</summary>

1. Notion → an internal integration "Job Pilotto Live-Test" in the owner's workspace; share only the Live Test page with it.
2. `security add-generic-password -U -a job-pilotto -s job-pilotto.notion.token-live-test -w '<secret>'`
3. `python3 tools/notion_copy.py create --token job-pilotto.notion.token-live-test --parent <Live Test page id>` → save the printed ids as
   `NOTION_*=<id>` lines in `~/Library/Application Support/Job Pilotto (live test)/ids.env`.
4. `npm run twin` does the first full copy (about 10–20 min; later syncs only update).
</details>

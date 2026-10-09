# Live test: a twin of the owner's app

> **Verdict:** to see a fix work on the owner's real state and real websites, run `cd desktop && npm run twin`.
> A second app (its own window, port and browser) on a fresh copy of the real app folder, with Notion replaced by a one-way mirror.
> Nothing it does reaches the owner's app window, Chrome windows, Telegram or real Notion. Never Submit. (Owner, 8 Oct 2026.)

| | Owner's app | Twin |
|---|---|---|
| Folder | `~/Library/Application Support/Job Pilotto` | `…/Job Pilotto (live test)/home`: a fresh clone at each start |
| Notion | "Job Pilotto - mac - Photographer" | "🧪 Job Pilotto – Live Test" (one-way mirror, synced at each start) |
| Token | Keychain `job-pilotto.notion.token-desktop-real` | Keychain `job-pilotto.notion.token-live-test` (404 on every real database: checked at start) |
| Browser | the owner's Chrome | its own visible Chromium window, one tab, fresh profile with the sign-ins carried over, extension copy on the twin's port |
| Port | 47111 | a free one (`twin.json`) |
| Telegram, schedules, Always on, telemetry | on | off (`desktop/lib/twin.js`) |
| AppleScript on Chrome / Terminal | yes | off |
| Apply with Claude / Take over with Claude | your Chrome (`--chrome`) | the twin's own Chromium only: `--no-chrome` + a Playwright MCP on its port, the submit guard as init script, job-site passwords masked (`--secrets`) |
| Engine's Keychain (Telegram bot, Google sign-in) | yes | none (`src/secret_store.py` `isolated()`) |
| Real websites, Keychain site passwords, AI | yes | yes (real AI spend: say the cost) |
| Keychain writes (a new site password, a Google sign-in) | yes | never: the twin's own file `isolated-secrets.json` in its folder (`desktop/lib/keychain.js`, `src/secret_store.py`); it reads that file first, then the real site passwords only |

## Run it
- `cd desktop && npm run twin` (or `--no-sync` to skip the sync). Ctrl-C stops the app and its browser.
- **Drive it with `npm run twin:drive -- <command>`** (in `desktop/`; `desktop/e2e/twin-drive.mjs`). Every click and keystroke is outlined in
  orange with a "Claude: …" caption first, so the owner watching sees what is pressed; a form's Submit is refused in any language.
- **Update it live, without closing it: `npm run twin:drive -- refresh [--tabs]`** (9 Oct 2026). The twin's worktree goes to `origin/main`; a changed extension is rewritten in place and reloaded
  through `chrome://extensions` (NOT `chrome.runtime.reload()`: Chrome 153 leaves a command-line extension disabled after it); a change to the app's main process (`desktop/lib`, `main.js`, `worker/src`) restarts
  the app alone, with its whole process group and its ports; anything else reloads the window. The browser, its tabs and sign-ins stay (`--tabs` also reloads the tabs so their panel gets the new script, which
  loses those pages' fill state). Not covered: a change to `twin.mjs` itself needs one restart of the twin. Code: `e2e/lib/twin-refresh.mjs`, guarded by `e2e/test/twin-refresh.test.mjs`.

  | Command | Does |
  |---|---|
  | `inspect <session>` | the app's view (left, pending, proposals) + the page's own state per pending field (never a password) |
  | `reopen <session>` | the card's "Open in Chrome" path (the form reopened with the fill mark when its tab is gone) |
  | `press <text> [why]` | a visible click in the **app** on the control showing that text (Applying, a session, Apply). Drive the app through its own screens like this, never with `app "window.pilot.…"`: the owner watches the app too (9 Oct 2026) |
  | `click <tab> <selector> [why]` | a real click in the twin's browser (`tab`: part of its address) |
  | `type <row title> <text>` | types into a Needs your attention row and presses Enter |
  | `app "<js>"` / `page <tab> "<js>"` | reads state from the app window / a tab |
  | `shot app\|<tab> <file.png>` | a screenshot |
  | `arrange` | both windows to the front, the browser on the right half |
- **Watch in short steps** (global rule "Watching a live run"): after `reopen`, the extension's first line ("page kind", "filling") must come within
  ~20 s; then read the log every ~5 s and decide: progressing, done, or stuck (stop and look).
- **The browser starts with one tab** (the extension's install page is blanked and reused) and a **fresh profile each start**: only site sign-ins
  (cookies, local storage) are carried over from `…/Job Pilotto (live test)/browser/` and saved back at stop. Its extension copy has "all sites"
  access built in, as granted once in the owner's Chrome.
- **After each fill** the twin's log has one `fill: fields: N filled, M left` line: every field's outcome, source and reason, as the page holds it at the end.
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

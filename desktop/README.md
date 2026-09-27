# Job Pilotto — desktop app (macOS)

The local-first cockpit for Job Pilotto: a setup wizard, your jobs with fit scores, your strategy,
and **Apply to N jobs**. Your data (CV, Profile, answers, job database) lives in
`~/Library/Application Support/Job Pilotto`; keys are encrypted with a key held in your Mac's
Keychain (Electron `safeStorage`) and never leave the Mac except to the service they belong to.
No server, no GitHub Actions, no Cloudflare needed.

## Run it (development)

```bash
cd desktop
npm install
npm start
```

It runs the Python pipeline from this repo (`../src`, with `../.venv` when present, else `python3`
with `pip install -r requirements.txt`).

## What's in it

| Screen | What it does |
|---|---|
| **Setup wizard** | Anthropic key (checked, then stored encrypted) → CV (PDF) → a short questionnaire → Claude drafts your Profile, standard answers and search settings from both (about USD 0.05–0.10), you review and save → optional extras |
| **Jobs** | Every open job, best fit first; **Find new jobs** runs job boards, employer feeds and (with keys) Google Jobs, AI facts and fit scores; Save / Applied / Dismiss per job |
| **Apply to N jobs** | Picks your best open matches (saved first). **In Chrome with the extension**: opens them as tabs; the extension fills each form, you review and submit. **AI agent sessions**: one Claude session per job in Terminal (`tools/apply-batch-claude.sh`), needs Notion |
| **Strategy** | Edit your Profile and standard answers; rebuild them from your CV |
| **Settings** | Keys (Anthropic, Notion, SerpApi), the Chrome extension connection, your data folder |

The Chrome extension connects to the app on this Mac (`http://127.0.0.1:47111` plus a token shown
in Settings) instead of a Cloudflare Worker; it reuses the same endpoint code
(`worker/src/extension.js`) with your local Profile.

## Layout

- `main.js` window, actions and the local extension server; `preload.cjs` the window's only bridge.
- `lib/storage.js` settings and encrypted secrets; `lib/pipeline.js` runs `src/` with your folder and
  keys; `lib/strategy.js` CV → strategy draft; `lib/apply.js` Apply to N; `lib/server.js` extension
  endpoints on 127.0.0.1.
- `renderer/` the window (plain HTML, CSS and JavaScript).
- Tests: `npm test` (no Electron needed). Smoke test: `JOB_PILOTTO_USER_DATA=/tmp/pilot JOB_PILOTTO_SMOKE=/tmp/shot.png npx electron .`
  renders hidden, saves a screenshot and quits.

## Not yet

Telegram from the app (long polling, no webhook), scheduled searches while the app runs, local
application kits (today kits live in Notion), meeting recording and transcription, a signed and
notarised build.

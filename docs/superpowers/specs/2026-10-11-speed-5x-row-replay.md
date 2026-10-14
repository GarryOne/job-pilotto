# Speed-5x: a failing pool row replayed offline in seconds

Owner, 11 Oct 2026: the fix-recorded-sites loop 5x faster. Seven fixer sessions spent 9.9 h and confirmed 0 rows because each layer of a bug showed only in a
live run hours later. The fix: a failing pool row becomes an offline replay on the app's own path (the real extension, the app's own server under plain node,
the row's recorded pages and model answers), proven to show what the live run showed; live runs stay to confirm a fix once.

- Landing 1: capture every page, frame and stylesheet of a live run, and the app's model answers.
- Landing 2: `npm run row` / `npm run rows` replay rows offline; the row follows the live run's states after each press; a trust check proves it.
- Landing 3: live and smoke runs move off Electron onto the plain-node app.

Owner decisions: landing 1 (11 Oct), step 0 then landing 2 (11 Oct), the privacy tripwire (11 Oct), "follow the live journey" (11 Oct).

## Landing 3 design (notes, 11 Oct 2026)
- The live run (desktop/e2e/lib/apply-live.mjs runLive, suites/apply.mjs) uses the Electron app only through `window.pilot`: saveContact, saveSettings, applyOne, sessions.
- Each is a thin IPC wrapper over a plain function on the storage (e.g. lib/apply-handlers.js `ipcMain.handle('applyOne')` -> lib/apply.js `applyOne(storage, url, details)`).
- So landing 3 runs the live row on the offline app's process (lib/offline-app-child.mjs, the network open for the run) with a small command channel that calls those
  functions, and the real extension in the harness browser; no Electron window (27 s start, 0.56 GB) and the same evidence lines.

## Progress

### 1. Landing 1: the capture
- [x] Every page and frame under its own address, applied CSS, the model answers (e68d362; Windows fix 29f8d91)

### 2. Step 0: the replay sees what the live run saw
- [x] One fake contact for both scrubs; the extension's own UI out of every page reader (641d50f)

### 3. Safety for live runs
- [x] The harness never runs a terminal's claude wrapper (7d8b948)
- [x] The privacy tripwire on what is typed into real pages (e0fce93)
- [x] Skill fix-recorded-sites: journey candidates, privacy, 4-tab replays (5110a39)

### 4. Fresh captures (each state in order, the presses, the window size)
- [x] The capture keeps each settled state, each page at the extension's ask, the live presses (presses.json), the window size and document (this landing)
- [x] Three guarded live captures with them (coreweave, jobs.ch, Recruitee; 5 rounds, no tripwire hit, no owner value in any file)

### 5. Trust check
- [x] Recruitee replays with the same evidence lines as live (page kind 2/2, pressed 2/2, went to 1/1)
- [x] jobs.ch replays with the same evidence lines as live (page kind 3/3, both presses followed, went to 1/1; the one field off is the harness's tab count)
- [x] coreweave replays with the same evidence lines as live (page kind 2/2, pressed 1/1, went to 1/1 once field ids were no longer scrubbed as phones: be7b60b)
- [x] A build without a fix replays differently (step 0 undone: Recruitee's form page misses its kept answer, the fixed build's hits)

### 6. npm run rows
- [x] Every row of the day offline in one browser and one app (this landing)
- [x] Rows in 4 tabs at once, rows sharing a host apart, a diverged row re-run alone (this landing)

### 7. Skill step
- [x] fix-recorded-sites: replay the row offline first, confirm live once (this landing)

### 8. Land landing 2
- [x] Offline app, memo-only, npm run row/rows, the follow, the trust check on main (this landing)

### 9. Landing 3: live and smoke runs off Electron
- [x] The app's own commands without a window: Apply, the contact, settings, sessions (offline-app-commands.mjs; this landing)
- [x] A live row on the plain-node app and the harness browser, with the ask capture and the tripwire (live-row.mjs, npm run live; this landing)
- [x] Smoke runs a row this way (SMOKE_NO_ELECTRON=1), printing the lines it parses (this landing)
- [x] Trust: the same rows on both paths reach the same step and fill the same fields (Recruitee form 4/1, jobs.ch form 6/2, coreweave form 10/12)
- [x] Landed (bfa4ae1); the default for smoke (owner, 11 Oct 2026; SMOKE_ELECTRON=1 is the way back)

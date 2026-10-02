---
name: improve-filling
description: Improve the Job Pilotto Chrome extension's form filling from its recorded runs. Use when asked to "improve filling", review extension failures, or on the weekly improvement routine.
---

> **2 Oct 2026: the extension's code is in the private repo `GarryOne/job-pilotto-extension`.** Steps below that edit `extension/…`
> are done in a checkout of that repo (its root is the old `extension/`: `page/fill.js`, `manifest.json`, `npm run fingerprint`).
> The fixtures stay here (`worker/test/fixtures/fill/`); the replay test runs there (`test/replay.test.js`, with this repo beside it
> or `JOB_PILOTTO_PUBLIC_REPO`). `tools/fill-fixture.mjs` still makes the fixture here.

# Improve the form filling from recorded runs

Every extension fill writes a record to Notion's 🎏 Job Apply — Agent Runs (Agent = Extension): a
field-by-field table (answer source, result, why) and a Debug data JSON block (the form as read, every
answer with its source, dropdown attempts, step timings, errors, extension version).

1. **Collect**: `python3 tools/fill-failures.py --days 14` (add `--json` for details). It groups every
   field left unfilled by reason and job site, most frequent first, with links to example runs.
   Ignore groups whose latest version is older than the current `extension/manifest.json` version
   unless they still occur in the newest runs.
2. **Diagnose** the top groups: open 1–2 example runs (fetch the page's code blocks) and compare the
   form as read (`debug.form`: label, type, options, filled) with the answers (`debug.answers`) and
   `debug.dropdowns`. Typical causes:
   - *no answer in the kit, Profile or your details* → a data gap, not code: it belongs in the user's
     standard answers (the app's "Answer once" list collects these); only fix code if a detail we
     already have wasn't matched (label patterns in `PROFILE_LABELS`, `extension/page/fill.js`).
   - *dropdown clicked, but no option matched* → option matching (`matchOption`) or the typed filter.
   - *answer given, but the field did not take it* → the widget needs real input (debugger typing,
     like the phone) or a different event.
   - a field type not recognised at all → `__jobPilottoDescribeForm`.
3. **Replay first, then fix** (one failing field = one fixture = one commit), in a git worktree:
   1. **Extract the snapshot**: `node tools/fill-fixture.mjs <issue> --answer "<representative answer>" --expect-picked "<option>"`
      (or `--expect-checked` / `--expect-value`). It reads the issue's `<!-- job-pilotto:snapshot v1 -->` block (the
      field's scrubbed HTML: label, container, the open menu's options) and writes
      `worker/test/fixtures/fill/<site>--<label>.html` + `.json`. The answer is a *representative* value of the kind
      the kit gives (e.g. "Master's"), never the user's real one. No snapshot on the issue (older reports)? Build the
      fixture by hand from the public form's structure, `"source": "synthetic"`, like the seeded Greenhouse ones.
      Without `node` (the daily fixer's allowlist): `gh issue view <n>`, then Write the two files yourself: the
      ```html block verbatim as `.html`, and a `.json` like the seeded ones with `"source": "issue #<n>"`.
   2. **See it fail**: `cd worker && node --test test/fill-replay.test.js` (or `npm --prefix worker test`). It runs the real `extension/page/fill.js`
      on the fixture in jsdom (a dropdown gets a trusted click, as in Chrome). If it passes, the fixture doesn't
      reproduce the failure: fix the fixture or the expectation first, not the code.
   3. **Fix** `extension/page/fill.js` (or `__jobPilottoDescribeForm`), until the fixture passes and every other
      fixture still does. Unit tests for helpers can go in `worker/test/extension*.test.js` too.
   4. Commit the fixture with the fix. Bump `extension/manifest.json`'s version and run
      `node desktop/scripts/extension-fingerprint.mjs --write` (desktop/test/extension-version.test.js checks it), so
      new runs are distinguishable. If `tools/browser-*.js` or `extension/page/snapshot.js`'s scrubber changed, run
      `extension/sync.sh`.
   Privacy: fixtures are public. Never paste anything from Notion's run records or the user's form into a fixture by
   hand; only the issue's scrubbed snapshot or public form structure (`worker/test/fill-replay.test.js` rejects
   emails, URLs, phone-like numbers, scripts, links and styles in fixtures).
4. **Verify**: `cd worker && npm test` (includes every replay fixture), then push (the pre-push hook runs every suite).
5. **Report** to the owner: what failed, how often, what changed, and which failures are data gaps
   for them to answer (never invent personal answers).

Never make the extension click Submit, and never change what counts as a legal/consent box.

---
name: improve-filling
description: Improve the Job Pilotto Chrome extension's form filling from its recorded runs. Use when asked to "improve filling", review extension failures, or on the weekly improvement routine.
---

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
3. **Fix** in a git worktree, one cause per commit, with a test in `worker/test/extension*.test.js`
   (the page helpers run in `vm`; see existing tests). Bump `extension/manifest.json`'s version so new
   runs are distinguishable. If `tools/browser-*.js` changed, run `extension/sync.sh`.
4. **Verify**: `cd worker && npm test`, then push (the pre-push hook runs every suite).
5. **Report** to the owner: what failed, how often, what changed, and which failures are data gaps
   for them to answer (never invent personal answers).

Never make the extension click Submit, and never change what counts as a legal/consent box.

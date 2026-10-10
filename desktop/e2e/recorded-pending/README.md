# Recorded pages waiting for a build that handles them (not replayed: loadCases reads only e2e/recorded/)

Both are replayed with the harness through scratch scripts (coordinator: `ladder-debug/dbg2.mjs`); copy a folder into `e2e/recorded/` to replay it with `JP_REPLAY=1 REPLAY_ONLY=<name> node --test test/recorded-pages.test.mjs`.

- `aldi-apply-outside-sketch-1` (10 Oct 2026): Apply control outside the sketch's 20 buttons, found by the shared phrases. PASSES on the landed build and on ai-ladder (11 Oct control runs): move it to `recorded/` as a guard.
- `digest-press-unknown-word-1`: the same shape with a link text no shared phrase knows. FAILS on the landed build 1b24715 (nothing pressed: the digest's answer is only reported at a stall), PASSES with the stall press of ai-ladder (extension 0.9.177: "pressed the control the digest named"). Move it to `recorded/` with that change: it is its proof (REAL_EXTENSION_DIR=<landed build> fails it).
Both stub `/extension/answer` (eligible, no answers): without it the stand-in app answers `{}`, the extension reads "not eligible" with no note and `ineligibleNote(undefined)` throws (see the coordinator's report).

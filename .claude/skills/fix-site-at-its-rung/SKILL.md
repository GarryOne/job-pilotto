---
name: fix-site-at-its-rung
description: Fix a page the applying flow gets wrong at the rung of the ladder that decided wrong, with the smallest fix (data before code), and prove no other site got worse. From a failing pool shape on /admin/applying (or a live bug) to the rung map, the fixture, `npm run ladder-score`, the recorded replay and the honest baseline update. Use when a pool shape stops at "posting"/"no-form", a page was classified wrong, or the owner says "fix this site at its rung", "/fix-site-at-its-rung".
---

# Fix a site at its rung: the lowest rung that has the information, data first

Map: `docs/flows/ladder.md` (rungs, owners, fixed answers, what may change). Spec: `docs/superpowers/specs/2026-10-10-ai-ladder.md`.
Companion of `fix-failing-forms` (which fixes what happens AFTER the right page kind is known: fill, upload, controls). This skill is for "the page was judged or climbed wrong".
Rule of the product: **never fix a website; fix a shape.** The site is one live sample.

## 0. Coordinator and the e2e page
Find the coordinator: `cat "~/Library/Application Support/Job Pilotto QA/coordinator.txt"` names the session that owns the applying test pool and the shared e2e page (it rewrites the file when it starts or its session name changes). If that name is not in `ListAgents`, no coordinator is running: ask the owner before any run on the e2e page. Tell it the shape you take and ask before any run on the e2e page (one run at a time on it). The ladder's design is job-pilotto-cc's: tell it before you touch the flow core.

## 1. Find the rung that decided wrong (5 min, no edits)
- `/admin/applying` pool table "Rung" column, or `logs/app.log`: `page kind: <kind> by ai|remembered`, `structure rule`, `closer look`, `takeover`.
- Map: by `ai` = rung 2, `remembered` = 1, structure rule = 0 (after unsure or no AI), closer look = 4, takeover = 5.
- Say in one line: "decided at rung N, said X, truth is Y, because <the sketch shows / lacks Z>".
- Look at the sketch the rung really saw: `cd desktop && node e2e/ladder-capture.mjs --dir <scratch dir with one fixture json>` (read-only GET, bare Chromium) or the fixture of that shape in `desktop/e2e/ladder-fixtures/`.
  The usual causes: the Apply control is not in the first 20 buttons (navigation crowds it out); the page is a frame (`frames` only); the instruction is in text the sketch does not carry.

## 2. Make the case a fixture first (it must fail or be wrong-and-confident)
- Add `desktop/e2e/ladder-fixtures/<shape>.json` (`source`: captured for a real page via `capture.url`; invented/reconstructed for a shape written as `pages/<id>.html`), `expect.outcome` from the real page, `accept` only for what the code cannot say yet.
- `node e2e/ladder-capture.mjs --only <id>`, then `npm run ladder-score -- --only <id> --record` (plan path, no API key) stores what the model says today.
- Add it to the baseline: `npm run ladder-score -- --offline --update-baseline "<shape>: added, <status today>"`.

## 3. The smallest fix, lowest rung first (in this order)
1. **Data** at the rung that can see it: a kept answer, an alias/meaning in the pack, a recipe, an example in the prompt. 2. **A prompt line about the shape** (not the site) at that rung.
3. **The sketch**: carry what was missing (a candidate, a frame host), found by structure only. 4. **A signal** so a higher rung is asked (flow core: claim it, read its "Invariants:" block, say so to the coordinator).
Never: a site name, a vendor or word list, a regex over natural language (`tools/hardcoded-page-words.mjs`), a fix in a higher rung for what a lower rung could see.
Flow-core files (`page-kind.js`, `fill-flow.js`, `session-flow.js`, `escalate.js`…) are claimed first (CLAUDE.md "The flow core").

## 4. What to run (say each result)
| Run | Shows |
|---|---|
| `cd desktop && npm run ladder-score` | live on the plan: the fixture now right? rates per source; the wrong-and-confident list did not grow |
| `npm run ladder-score -- --offline` and `node --test test/ladder-ratchet.test.js` | no stored fixture got worse (what the push gate runs) |
| `cd desktop/e2e && npm run recorded` | fixed sites still replay (also with `REAL_EXTENSION_DIR=<old extension/>` it must FAIL: the positive control) |
| `cd desktop/e2e && npm run real-extension` | the extension alone, if `extension/` changed |
| `cd desktop && npm test`, `cd worker && npm test` | the rest |

## 5. Update the baseline honestly
- Better fixtures: `npm run ladder-score -- --offline --update-baseline "<what improved and why>"` (re-record the answers first with `--record` if the prompt changed).
- A fixture that got **worse** is a bug to fix, not a baseline edit. A deliberate trade-off needs the owner's say-so, written in the commit.
- Never edit a fixture's `expect` to make it pass; the ratchet fails on an edited expectation unless the baseline is updated with a reason.

## 6. Land
Commit subject ≤ 72 chars; body: the rung, the shape, the before/after status line from `ladder-score`; `Recorded-unneeded:` only when no real-site failure is fixed. Land with `tools/ship.sh`; tell what other sites this helps and what it does not cover.

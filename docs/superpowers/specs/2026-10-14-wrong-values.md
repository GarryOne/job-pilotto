# Wrong-value checks in the offline replays (owner, 14 Oct 2026; Discussion #650)

Today a field filled with the wrong value counts as filled in every replay row. Two $0 layers, no AI judge.

## Where each check runs
- **Replies kept:** `lib/app-front.mjs` keeps the app's replies to `/extension/answer` and `/extension/pick-choice` in memory (`front.replies`); never written to disk (`ai-calls.json` keeps no values).
- **At the replay's end** (`runLiveRow`, beside `readLive`, last application tab): `lib/wrong-values.mjs` runs both layers; `replay-net.mjs` opts in, live rows do not change.

## Layer 1: typed = decided
Reuses `lib/replay-truth.mjs` (`expectedAnswers`, `readTab`, `truthFailures`, `pickedChoices`), no second reader. Input: answers with `use: "fill"` (a proposal is not typed).
- Wrong: the field holds a value that is neither the answer nor a picked choice.
- Known gap: only the LAST tab is read, so a multi-page form's earlier pages are not checked.
- Not wrong, only not counted: field not on the last tab, empty, unreadable (lone checkbox, file).

## Layer 2: decided = right (known facts)
Per answer, by the answer's own `fact` key (fixed list, `worker/src/answer-facts.js`), against the fake applicant (`apply-fixtures.mjs` CONTACT):
- `contact`: an e-mail-shaped value equals the applicant's e-mail; a phone-shaped one has the same digits; a link equals the saved link; any other value uses only words of the applicant's name, street, postal code, location.
- `home_location`: every word is one of the applicant's location, street, postal words (Israel for Switzerland = wrong).
- Out (the right answer depends on the question's direction, which only an AI reads): yes/no facts (work permit, sponsorship: "need a visa?" and "may you work?" have opposite right answers), salary, years, free text.

## What "worse" becomes
`replay.json` outcome gets `wrong` (count) and `wrongValues` (field, held value, answer; fake data). `replay-gate.mjs fell()`: `wrong` above the baseline's = worse, why `wrong values N (baseline M)`. A baseline without `wrong` never counts (its first run only records it). The run summary LISTS every wrong field (row, field, fake expected vs typed) every run, so a value wrong since the baseline stays visible.

## Progress
- [x] lib/wrong-values.mjs + unit test (proof: desktop/e2e/test/wrong-values.test.mjs)
- [x] app-front replies, runLiveRow hook, replay-net summary (proof: desktop/e2e/test/wrong-values.test.mjs)
- [x] gate: fell() + test (proof: desktop/e2e/test/wrong-values.test.mjs)
- [ ] by-hand replay on main and branch, rows listed
- [ ] Yes/no facts (work permit, sponsorship): needs the question's direction: AI-only, not in CI
- [ ] PR, link in Discussion #650

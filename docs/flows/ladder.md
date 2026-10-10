# The ladder: which rung decides what, and where a site fix belongs

**Verdict (5 s):** a page decision climbs from the cheapest rung to the next only when unsure. **Fix a site at the lowest rung where the information exists, and fix it as data
(a kept answer, a recipe, a prompt example) before code.** Never fix a site in a higher rung than needed, never in a rung that already answered right.
Spec: `docs/superpowers/specs/2026-10-10-ai-ladder.md` (checklist = what is built). Applying flows: `docs/flows/applying.md`. Skill for the work: `.claude/skills/fix-site-at-its-rung/SKILL.md`.

## The rungs
| Rung | What | Owner (file) | Fixed answers | Built |
|---|---|---|---|---|
| 0 | structure rule | `extension/tab-pages.js` `pageRole` | `form` · `account` · `no-form` | yes: answers only without AI |
| 1 | kept answer per page shape | `desktop/lib/page-kind.js` `pageKindCache`, `kindKey` | the kept `kind` (+ buttons) | yes |
| 2 | text sketch to a small model | `desktop/lib/page-kind.js` `pageKind`; `account-judge.js` | `KINDS`, `APPLY_BY`, `ROUTES`, `account_step`, `bot_check` | yes |
| 3 | numbered digest | none yet | outcome + closed verb + candidate numbers | **not built** |
| 4 | screenshot + sketch, strongest model, one action | `desktop/lib/escalate.js`, `extension/escalate.js` | one action from the page's own controls | yes: accounts; forms when a fill put nothing in |
| 5 | Claude takes over | `desktop/lib/take-over.js`, `extension/panel-claude.js` | none (a session) | yes: once per application |
| 6 | the person | cards (`renderer/`), `application-journey.js` `stuck` | the sentence quoted from the page | yes: generic text; quoted for email only |

The router (which rung to ask next, from a rung's signal): `extension/ladder-core.js` (`RUNGS`, `SIGNALS`, `nextRung`, `ladderLine`); the climb that uses it is extension/ladder.js (landing on branch ai-ladder).

The sketch every rung reads is one list: `SKETCH_FIELDS` in `page-kind.js` (extension builds it in `fill-flow.js` `pageSketchOf` + `non-form.js` `mailsOf`).

## What may change when you fix one site
| You may | You may not |
|---|---|
| Add a kept answer / recipe / alias / prompt example (data) | Add a site name, a vendor list, a word list or a regex to any rung |
| Teach rung N's prompt a **shape** (with a fixture) | Make a higher rung do what rung N can see |
| Add a fixture + stored answer + baseline line (with a reason) | Edit a fixture's expectation to make a failing one pass |
| Add a signal or a log line saying which rung decided | Let a rung read another rung's internals |
| Raise a cap only with the owner's say-so | Skip a rung that is off or capped; press Submit; pass a bot check |

Floors never move: never Submit, never a consent on an application, never a bot check or SMS code, never read a password field, one press per control per tab,
no AI = nothing pressed. A rung's answer is accepted only when it is one of the fixed answers and names something the page itself shows.

## How a change is judged (the safety net)
| Layer | What | Run |
|---|---|---|
| Fixtures | 38+ page sketches (real captures, recorded pages, reconstructed, invented, traps) with expected outcome and the model's stored answer | `desktop/e2e/ladder-fixtures/` |
| Score | per fixture expected vs got, rung that decides, rates **per source** (never blended), the wrong-and-confident list | `cd desktop && npm run ladder-score` (live, plan path) · `-- --offline` (stored answers) |
| Ratchet | no fixture may get worse than `desktop/e2e/ladder-baseline.json` | `desktop/test/ladder-ratchet.test.js` (runs offline in seconds; `tools/ladder-gate.mjs` on a flow push) |
| Recorded pages | a fixed site replayed with the real extension | `cd desktop/e2e && npm run recorded` |
| Real extension | the extension alone on a real form | `cd desktop/e2e && npm run real-extension` |

**Updating the baseline honestly:** improve a fixture, then `npm run ladder-score -- --offline --update-baseline "<why>"`; the reason is dated in the file.
A fixture that got worse is a bug, not a baseline edit; the only exception is a deliberate trade-off the owner agrees to, said in the commit.

## Invariants (what the tests guard)
- A rung's answer is one of its fixed values (`desktop/test/page-kind.test.js`); the structure rule never overrides a rung that answered (`desktop/test/flow-invariants.test.js`).
- Unsure currently goes **down** to rung 0 (spec gap 1); the score prints it as `unsure`, rung 0. Slice B changes this on purpose, with the baseline updated.
- Counts and logs carry the shape and the rung, never the page's text.

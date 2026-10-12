# Keep the fast code, end the dead ends, learn as data (design review, 12 Oct 2026)

> **Verdict:** keep everything that works today as the **fast tier** (free, instant). Change one thing: **no dead ends.** Where today's code gives
> up or needs a condition it does not have, it asks **one universal question** ("what is the next move here?", escalated by the ladder) instead of
> a new branch being written. A move that the page confirms is **kept as data** for that page shape, so the next visit takes the fast tier again.
> From now on, decision fixes are **data** (a fixture, an example, a learned move, a pack entry); code changes only where code is the right home:
> reading the page, operating a control, the safety floors.
>
> Status: **approved by the owner, 12 Oct 2026 (decisions 1-4: yes).** Implementation: session job-pilotto-next-move. (Replaces this file's first
> version, "one next move replaces the chain".)

## What the data says (measured 12 Oct 2026)
| Source | Finding |
|---|---|
| CI + Mac pool, 75 rows, last run each | **form 36, ready 1** · stopped before the form: **account 10, posting 6, none 2** (dead ends) · bot check 4 (correct stop) |
| Pool flows (sites) | posting → form 25 · **posting → account 16** · posting → other page 9 · account and form on one page 4 |
| 20-row CI test, field level | ~94% of fields handled (filled or proposed to confirm); real misses 6% |
| Scorecard (real use) | Ashby "Blind spot": 28% of matched jobs, real forms 59% filled; Greenhouse 45% of matches, fine |
| Applying commits, last 4 days (226, by subject) | **perception 66 · actuation 40** (reading the page, operating controls) · decision 46 · timing/tabs 23 · answers 7 · floors 7 · other 37 |
| Learned data in D1 (shared, served as a pack) | meanings 218 (mostly seeded) · aliases 33 · **recipes 1** · control outcomes 4 · meaning votes 0 · application outcomes 0 |
| Learned data on the owner's Mac | page kinds kept: **3** (one of them the weak Amazon answer) · verified ladder learning: **none** |
| The decision code | `fill-flow.js consider()` 195 lines; 13 page-kind answer fields each read by a branch; 5 mechanisms in fixed order for a page with no form |

**Reading it:** about half of the code fixes (perception, actuation) are **universal by nature**: a better menu handler or label reader helps every site.
That code is the speed and the 94%, and it stays. The brittleness is in the **decision layer** (what kind, what next): a chain of gates where one
missing condition stops everything (Amazon), and every new shape became a new branch. And the **data path that should carry learning is almost
empty**: fixes went into code, real installs are few, and the CI pool's verified runs are not fed back (`applying report: not sent (CI)`).

## The design: three layers
| Layer | Home | Changes how |
|---|---|---|
| **1 Perceive and act** (page sketch, frames, layers, required marks; menus, typeahead, upload, retype; the fill per field) | **code, kept** | universal shape fixes, each with a widget-zoo page or recorded case. Unchanged. |
| **2 Decide** (which button, which route, what kind, when to stop) | **today's code = fast tier, kept** + **one universal fallback** | no new branches. Every dead end calls the fallback: the one question, escalated by the ladder (kept move → sketch → digest → picture → Claude → person). |
| **3 Learn** (kept moves per page shape, meanings, aliases, examples) | **data** | a move the page confirmed (the form came, the value stayed) is kept for the shape; shared through the existing pack (k ≥ 3, fixed values only). Fed by real use **and the CI pool**. |

**Floors** (code, unchanged, at every layer): never Submit, never a consent on an application, never a bot check or SMS code, never read a password
field, one press per control per tab, only the page's own controls, only fields that are part of applying.

### The fallback and its escalation (the owner's question: yes, the ladder stays)
| Rung | What | Speed | Climbs when |
|---|---|---|---|
| fast tier | today's code paths, kept kinds and moves | instant, $0 | it reaches a dead end |
| 2 sketch | the question on the page as text, small model | ~1-3 s | unsure, refused by a floor, or the move did not work |
| 3 digest | numbered candidates + what was tried and why it failed | ~3-5 s | same |
| 4 picture | the same with a screenshot, strongest model | ~10-20 s | same |
| 5 Claude | takes over the tab (the person's press or the 5 s countdown, once per application) | minutes | it cannot finish |
| 6 person | told exactly what to do, quoting the page | | |

"Don't know" is a fixed signal (`extension/ladder/core.js`): unsure (< 0.8), contradicted (a kept move fails), stalled (pressed and nothing changed,
filled and the value did not stay, the same state twice), failed, or refused by a floor. Each climb carries what was tried. Speed comes back by
learning: what rung 4 solved and the page confirmed is the fast tier's next time.

## Why this keeps speed and reliability
- **Pages that work today take exactly today's path** (the fast tier is untouched): same speed, same result.
- **The fallback only runs where today ends at a dead end** (account 10, posting 6, none 2 of 75 pool rows): it can only add reach there.
- **Its one risk** is acting where stopping was right: guarded by the floors, by verification (a move that changed nothing is not repeated), and
  by a shadow phase first.
- **Cost** is spent only at dead ends, and drops as moves are learned.

## The rule for every fix from now on (into `docs/flows/ladder.md` and CLAUDE.md after the OK)
| The failure | The fix is | Not |
|---|---|---|
| Wrong or no decision on a page (which button, route, kind, when to stop) | **data:** a ladder fixture + prompt example, or a learned move | a new branch or answer field |
| A field or control not read | code in perception, with a recorded or zoo page | a site-specific case |
| A control not operated | code in actuation (a widget handler), with a zoo page | a site-specific case |
| A wrong value or wording | **data:** the meanings/aliases pack, the applicant facts | a word list in code |
| A safety gap | code in the floors | |

**Guard:** a ratchet test on the decision code: the number of page-kind/role conditions in `consider()` and the account step may only go down.
A commit adding one fails with "a decision is data: add a fixture or a learned move, or say why in `Decision-branch: <why>` (owner's OK)".

## Phases (each with its proof)
0. **Already done:** an account page with no step was a dead end (the owner's Amazon case): every account page now gets the normal fill (#486, 8691f97).
1. **Feed the learning that exists.** The CI pool and the recorded replays report their verified moves into the ladder learning (fixed values only,
   as today's `counts()`), so the pack fills with confirmed moves. Proof: after one CI pool pass, kept moves appear for the rows that reached a form.
   Same phase, learning hygiene: rung 1 keeps an answer only when sure (>= 0.8, and an account page only with its step); a weak kept answer is asked
   again. Ready on branch `weak-answer-not-kept` (cc, 12 Oct: `KEEP_FROM`/`sureToKeep` in `rung2-sketch.js`, a page-kind test and a journey scenario).
2. **End the dead ends, in shadow.** At each dead end of `consider()` (no Apply found, account page with no step, nothing filled, "other"), the
   fallback is asked and its move logged beside what happened. Proof: ladder fixtures and recorded pages offline (plan path, $0), one CI pool pass;
   switch on only if no fixture source is worse, the wrong-and-confident list is not longer, and the cost per application is shown to the owner.
3. **Switch the fallback on** at the dead ends; add the ratchet; write the fix rule into the rules.
4. Later and only by data: a fast-tier branch whose job the fallback plus learning always does as well may be deleted, one at a time, with its
   recorded cases green. Nothing is deleted for its own sake.

## Trade-offs
| | Today | This design |
|---|---|---|
| Known pages | fast tier | **the same** |
| A new page shape | a new branch (code), after someone notices | the fallback handles it now; the fix, if any, is data |
| AI cost | page kind once per shape; digest/picture on some stalls | **more only at dead ends**, falling as moves are learned |
| Predictability | branches | branches + a logged fallback (its reason in the log) |
| Risk | dead ends | the fallback acting where stopping was right: floors, verification, shadow |
| Code size | grows with every shape | decision code frozen (ratchet); perception/actuation grow only by universal shapes |

## Decisions for the owner
1. This direction: keep the fast code, end the dead ends with one escalating fallback, learn as data. **Recommended: yes.**
2. Phase 1 first (feed the existing learning from the CI pool and replays). **Recommended: yes**: cheap, no flow change.
3. Phase 2 in shadow before any switch. **Recommended: yes.**
4. From now on: decision fixes are data; the ratchet on decision branches. **Recommended: yes.**

## Progress
- [x] Owner's decision on 1-4 (12 Oct 2026: yes to all)
- [x] Phase 0: account pages with no step get the normal fill (#486)
- [ ] Phase 1: CI pool + replays feed verified moves into the ladder learning and the pack; rung 1 keeps only sure answers
- [ ] Phase 2: the fallback at each dead end, in shadow; fixtures and CI pool both ways; cost numbers
- [ ] Phase 3: switch on; the decision-branch ratchet; the fix rule in docs/flows/ladder.md and CLAUDE.md
- [ ] Phase 4: fast-tier branches retired only when proven redundant, one at a time

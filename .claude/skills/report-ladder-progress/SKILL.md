---
name: report-ladder-progress
description: Report where the AI ladder work stands, with one ASCII progress bar per item and one for the whole, read from the checklist in docs/superpowers/specs/2026-10-10-ai-ladder.md. Use after every commit or small step of the ladder work, at least every ~5 minutes while it runs, and whenever the owner asks "where do we stand" or says "/report-ladder-progress".
---

# Report the ladder's progress: bars from ticked boxes, never from feelings

The owner (10 Oct 2026): "report me back where we stand with the ladder and its gaps, with a nice ASCII progress bar for each item, to see how fast I'm progressing."

## The report (run it, paste it, add three lines)
1. `node tools/ladder-progress.mjs` (in the ladder's worktree). A bar is boxes ticked over boxes in the spec's `## Progress` list; nothing is estimated.
2. Under the bars, three short lines: **Done since the last report** (commits, what they closed), **Now** (the one thing in progress, and what the next box is), **Blocked or waiting** (a peer, the owner's yes, a run on the shared e2e page).
3. Say the **change since the last report** in one number ("3/19 -> 5/19, +2 boxes in 14 min"): keep the previous total in your head from the last report; if you do not have it, say "first report".

## Keeping the bars true
- **Tick a box in the same commit that finishes it** (edit the spec's checklist). A box is ticked only when its test passes, never for code that is written but not run.
- **A bar carries the owner's own name for the gap** ("Numbered digest", "Escalation router", "Learning"...), never a letter or an internal code. A new gap or a split step is a new box, written before the work starts, so a bar can go down: that is honest.
- Never round a bar up. A half-finished step stays unticked.

## When to run it
- After every commit of the ladder work, before the next step.
- At least every ~5 minutes of a long run (a ship, a suite): between steps, not by blocking. A timed ping while idle needs the owner's `/loop 5m /report-ladder-progress`: do not start a loop on your own.
- When the owner asks.

## Example of the shape
```
[░░░░░░░░░░░░░░░░░░░░]   0%  0/3  1. Confidence and contradiction signal (from every rung)
[░░░░░░░░░░░░░░░░░░░░]   0%  0/4  2. Escalation router (automatic climbing)
[░░░░░░░░░░░░░░░░░░░░]   0%  0/5  3. Generic triggers for postings and forms
[██████████░░░░░░░░░░]  50%  3/6  4. Numbered digest (rung 3)
[░░░░░░░░░░░░░░░░░░░░]   0%  0/2  5. Learning (write-back)
...
[██░░░░░░░░░░░░░░░░░░]  10%  3/31  THE LADDER (all items)
```
Guard: `desktop/test/ladder-progress.test.js` (the parser and the bars; the real spec must keep a checklist).

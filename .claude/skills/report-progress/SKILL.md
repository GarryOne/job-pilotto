---
name: report-progress
description: Report where any session's work stands with ASCII progress bars, at any moment: from a spec's "## Progress" checklist when there is one (the AI ladder, the faster-fixes actions), otherwise from the session's own PRs read from GitHub and its current task's steps; never "no spec, no bars". Use after every commit or small step of such work, at least every ~5 minutes while it runs, and whenever the owner asks "where do we stand", "progress?", "give me a progress bar" or says "/report-progress". To track new work this way, write its spec with a "## Progress" section first.
---

# Report progress: bars from ticked boxes, never from feelings

The owner (10 Oct 2026): "report me back where we stand with the ladder and its gaps, with a nice ASCII progress bar for each item, to see how fast I'm progressing."

## The report (run it, paste it, add three lines)
1. `node tools/ladder-progress.mjs --spec <the spec>` (default: the AI ladder, `docs/superpowers/specs/2026-10-10-ai-ladder.md`; the post-mortem actions: `docs/superpowers/specs/2026-10-11-faster-fixes.md`). New work: write its spec with `## Progress`, one `### N. item` per item, `- [ ]` boxes, a box ticked only with its landed hash. A bar is boxes ticked over boxes in the spec's `## Progress` list; nothing is estimated.
2. Under the bars, three short lines: **Done since the last report** (commits, what they closed), **Now** (the one thing in progress, and what the next box is), **Blocked or waiting** (a peer, the owner's yes, a run on the shared e2e page).
3. Say the **change since the last report** in one number ("3/19 -> 5/19, +2 boxes in 14 min"): keep the previous total in your head from the last report; if you do not have it, say "first report".

## No spec? Bars from the session's own work, never "no bars" (owner, 15 Oct 2026)
Every session answers with bars, at any moment. "This session has no spec with a ## Progress checklist, so there are no bars" is refused: build them from facts read now.
1. **One row per PR this session opened**, read from GitHub now, never from memory: `gh pr list --state all --limit 40 --search "[<short name>] in:title" --json number,title,state,statusCheckRollup`
   (a PR before 15 Oct may lack the tag: add the ones your history names). Merged = `1/1 100%  #n merged`; open = `0/1` with its checks (green, running, failing); closed unmerged: leave it out, or say "replaced by #m".
2. **One row for the work in progress**, with its steps as boxes under it: the brief's "Done when" steps, or 3-6 steps you write BEFORE the work
   (e.g. fixtures fail before the fix · fix written · fixtures pass · replay before/after · other cases not regressed · PR open and green). Tick a step only from a fact (a test's `# fail 0`, a run's result, the PR state).
3. **One row for the whole** (every box above), then the three lines and the change since the last report, as in the spec report.
4. Waiting work (a run, the owner's yes) is a box, unticked, named with what it waits on.
The shape (session 35, 15 Oct 2026):
```
[████████████]  100%  1/1  Read a page again while it still says Loading     #824 merged
[████████████]  100%  1/1  Replays read only published recordings            #858 merged
[█████░░░░░░░]   40%  2/5  Suggest-only location boxes (cause 2)
                           ✔ 3 fixtures that fail before the fix (keydown, input, decoy)
                           ✔ fix written (suggest-box.js + arming + real key press)
                           ☐ the fixtures pass with the fix
                           ☐ Lever's offline replay before/after, other cases not regressed
                           ☐ PR open and green
[██████████░░]   86%  6/7  THE SESSION (all boxes)
```

## Keeping the bars true
- **Tick a box in the same commit that finishes it** (edit the spec's checklist). A box is ticked only when its test passes, never for code that is written but not run.
  The ticked line names its proof: `(proof: <the test or file this PR changes>)`, `(proof: <path> @<sha on main>)` or `(proof: none: <why>)`; `tools/spec-proof.mjs` blocks the push otherwise.
- **A bar carries the owner's own name for the gap** ("Numbered digest", "Escalation router", "Learning"...), never a letter or an internal code. A new gap or a split step is a new box, written before the work starts, so a bar can go down: that is honest.
- Never round a bar up. A half-finished step stays unticked.

## When to run it
- After every commit of the ladder work, before the next step.
- At least every ~5 minutes of a long run (a ship, a suite): between steps, not by blocking. A timed ping while idle needs the owner's `/loop 5m /report-progress`: do not start a loop on your own.
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

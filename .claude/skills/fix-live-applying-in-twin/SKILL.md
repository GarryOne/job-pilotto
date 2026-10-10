---
name: fix-live-applying-in-twin
description: The live improvement loop for Job Pilotto's applying flow. Apply to real jobs in the twin, watch each step, find what failed, fix it universally, test, land, refresh, run again, until more forms reach "ready for your check". It also measures the self-improving form-filling mechanism every round (does what it learns get used, does it help, where is it blind) and improves the mechanism itself. Use when the owner says "twin loop", "/fix-live-applying-in-twin", "run the apply loop", or "make the active sessions perfect".
---

# Twin loop: apply live, observe, fix, test, repeat

The goal (owner, 9 Oct 2026): the extension takes every application **from the posting to a fully filled form, stopped before Submit**,
on any site and in any language. Every field is either filled or has a suggested answer, and the owner checks and validates it.
Every round should leave more forms closer to that point than the last one.

**The expected outcome of the self-improving mechanism (owner, 9 Oct 2026): form filling gets better with every iteration WITHOUT changing
the code, only through data** (the site's Cloudflare D1 database and the packs it serves). What one fill teaches (a wording's meaning, a widget's
recipe, a page's kind, an answer the person used) becomes data, and the next fill of that shape, on any install, uses it. A code fix is the
exception, for what no data can express (a new kind of operator, a reader blind spot); every code fix in this loop says why data could not do it.
So the loop is judged on two things: forms closer to ready, and **the share of each round's improvement that came from data, not code**.

## How it is invoked
- `/fix-live-applying-in-twin`: the **active Applying sessions** (status `input` or `done`, last 3 days) on the owner's twin.
  The pool of real test sites (the nightly smoke, `/admin/applying`, the QA smoke-reports) is NOT worked here: that is the skill
  **`fix-failing-forms`** (`/fix-failing-forms`), which reproduces each failing shape in the e2e harness with fake data. A pool shape that needs the
  owner's real state (their account, their Gmail) is handed to this skill by name, one at a time.
- `/fix-live-applying-in-twin jobs <n>`: also **n new jobs** from the owner's list (top fit, not yet applied, different sites/ATS than the sessions).
- `/fix-live-applying-in-twin <company or session id>`: just that one.
- `/fix-live-applying-in-twin rounds <n>`: stop after n fix rounds (default: keep going until nothing improves or the owner stops it).
- `/fix-live-applying-in-twin mechanism`: only the mechanism check below (fleet numbers, gaps, one fix), no live runs.

## Before the first round (once)
1. Read `docs/live-test.md` ("Working with the twin as an agent"), `docs/flows/applying.md` (the scenario map), and the Notion page
   "Self-improving form filling: design & plan". The repo rules in `CLAUDE.md` apply in full: worktrees, `tools/ship.sh`, universal fixes, 500 lines per file.
2. **Twin up:** `pgrep -f e2e/twin.mjs`. If it is not running, start it (docs/live-test.md step 1) in the background, with a Monitor on `^twin: (running|refresh)`,
   **from a worktree of its own that you never edit or ship from** (`tools/worktree.sh twin-host-<date>`): `tools/ship.sh` removes the worktree it lands,
   and a twin whose folder is gone can no longer refresh (10 Oct 2026: a forced restart, the tabs lost). Fixes go in other worktrees.
   **Account steps in full mode:** the twin's Settings → Profile → "Create and sign in to employer accounts for me" is on (owner, 10 Oct 2026), so it
   gets past account pages to the form; a profile reset turns it off again: check it (`accountAutomation` in the twin's `home/settings.json`), and
   switch it on through the screen (`twin:drive press`), never by editing the file.
   Then `cd desktop && npm run twin:drive -- refresh` so it is on `origin/main`. Check that the printed version is the latest.
3. **Peers:** `ListAgents`, then tell the other sessions that you hold the twin, and for how long. Ask whether anyone is fixing the same flow (`git log --oneline -15 origin/main` first).
4. **Tell the owner in one line** what the window will do: open postings, fill forms, create site accounts (full mode: it accepts an account's
   terms and presses its button).
   And what it never does: **Submit, a bot check, a password value, an email code**.
5. Arm one Monitor for the whole loop (re-arm it when it expires):
   `tail -n 0 -F "$HOME/Library/Application Support/Job Pilotto (live test)/home/logs/app.log" | grep --line-buffered -E "\[extension\] (fill: (filled the form|fields: [0-9]+ filled|account (button|result)|pressed the Apply|closed a popup)|account judgment|consent accepted|account: )|\[review\] stage .*: the|application ended"`
   (narrow on purpose, 10 Oct 2026: `picked for you` and a bare `bot` matched the visit list and filled the session with noise). Test it once with
   `grep -cE '<pattern>'` on the log so far before arming it.

## One round
For each target, one at a time (only one fill at a time, so the log lines stay readable):

0. **Twin still alive?** `pgrep -f e2e/twin.mjs` at the start of every round (a profile reset or an app quit stops it: 10 Oct 2026, found late).

1. **Run it.** For a session: `npm run twin:drive -- app "window.pilot.sessions().then(l=>JSON.stringify(l.map(s=>[s.id,s.company,s.status])))"`
   (reopen takes an **id**), then `npm run twin:drive -- reopen <id>`. For a new job, use `npm run twin:drive -- press "<text>"` on its Apply in the app.
   Do it visibly; never call `window.pilot` to act.
2. **Observe each step** from the Monitor events. Say one line for each: page kind → account step (judge, press, outcome) → form → fill (n filled, n left).
   The first sign of life must come within ~20 s; if it doesn't, it is stuck, so diagnose it now.
3. **Read where it stopped:**
   - `npm run twin:drive -- inspect <id>` shows what is left, what is pending and what is proposed, plus the page's own state for each field.
   - The trace's `fields` (outcome + reason per field) is in the `fields: N filled` line.
   - `twin:drive page <host> "<js>"` reads the page's structure (buttons, labels, `hasValue`), **never a value**.
4. **Score it** (one row per target in `<scratchpad>/fix-live-applying-in-twin/scorecard.md`, kept across rounds):

   | Target | Site/ATS | Reached | Filled / total | Left (reason) | Stuck at | Version |
   |---|---|---|---|---|---|---|

   **Reached** is one of: posting, account, code/bot (the person's), form, or **ready** (filled, and every empty field has a suggested answer).
   Fill it from the log, not by hand: the twin's `app.log` lines since the run started, read by the smoke's own parser
   (`node -e "import('./desktop/e2e/lib/smoke.mjs').then(m => console.log(m.parseLive(require('fs').readFileSync(process.argv[1], 'utf8'))))" <log slice>`):
   reached, filled, left, page kinds; `signature()` names the flow, the same words as the pool (`fix-failing-forms`).
   **A code or a bot check: mark it and move on at once.** The Gmail check runs by itself after a sign-up and on a pending account's page; the session
   card says what the person must do. Never wait on it inside a round.
5. **Pick the biggest blocker** across all targets. The earliest step comes first: a session that never reaches the form loses every field after it.

## Measure the self-improving mechanism (every round)
The loop fixes forms; the mechanism should make most of those fixes unnecessary by learning them. So every round also checks that the
mechanism works, helps and is not blind. Design: Notion "Self-improving form filling: design & plan". Its parts:
- **Notice the miss:** coverage, menu reasons, miss reports with a fingerprint.
- **Learn it:** recipes by fingerprint, meanings in the alias pack, remembered page kinds, proposals.
- **Serve it back:** the token-gated pack, and the canary at 5% for a new recipe.
- **Measure it:** the digest.

Twin fills count as real use since d8cbe63, so they feed it both ways.

1. **The fleet numbers.** Fetch them with the key from the Keychain. **Never print the key**, nor any user text:

   ```
   K=$(security find-generic-password -s job-pilotto.site.api_key -w); curl -s -H "Authorization: Bearer $K" https://www.jobpilotto.top/admin/form-filling/digest.json
   ```

   Save each read as `<scratchpad>/fix-live-applying-in-twin/digest-r<N>.json` (round 0 = before the first round) and diff it against round 0: the weekly
   windows barely move inside one loop, the diff and the recent vs earlier window do. The fleet numbers include the twin's fills (since d8cbe63
   it reports under the owner's install id, so it is never counted as another install): a jump after a round is the twin, not new users.
   Read these, and keep them in the scorecard's **Mechanism** table with the round they were read in, so a trend shows:
   - `thisWeek`: `filledShare`, `proposedShare`, `formsNeedingNothing`, `unreadPer100`, `medianSeconds`, `forms`.
   - The `versions` row of every version shipped in this loop: did it move the shares?
   - The top 5 `weaknesses`: `cause`, `title`, `now` vs `before`.
   - `proposals` (`bySource`, `byFamily`): what the person did with proposed answers. **Never press Use in the twin** to make this move:
     used / edited / ignored is the owner's judgment, and Use saves the answer for every later form.
   - **What was learned, as data** (owner key as above, never print it):
     - recipes: `GET /api/recipes?status=candidate` (waiting), `GET /api/recipes` (canary + verified), and the "Recipe funnel" card on `/admin/form-filling`;
     - wording meanings: `GET /api/knowledge` (question wordings 3+ installs met, alias proposals and how they fared);
     - what the proposer should work on next: `GET /api/recipes/targets`.
2. **The live signals from this round's runs** (in `app.log` and the trace). Did the learned layer act? Count per run:
   - page kind `by: remembered` vs `by: ai` (a shape learned once, reused for free);
   - rows of the `fields: N filled` line with an `alias` (the pack meaning that placed the field, a key such as `location`);
   - `recipes` on the same line: how many shared recipes set a control in this fill;
   - proposals shown, and used by the person (`inspect` shows `proposals`);
   - misses reported with a fingerprint (menu reasons, unread questions, unknown uploads);
   - did this fill's record reach the site? (`forms` in the digest went up after the run).
3. **Judge it. Each check below is a yes or no, with its evidence:**
   - **Learns:** a miss in round N became data (a recipe, a meaning, a remembered kind) by round N+1, without code. The learning jobs run once a
     day in the private repo (`proposer.yml` recipes, `aliases.yml` meanings, `form-learning.yml`; the site's canary judge daily), so within one
     loop: when a round produced new misses with a fingerprint, run them by hand (`gh workflow run proposer.yml -R GarryOne/job-pilotto-internal`,
     the same for `aliases.yml`; each is capped at cents, say the cost in one line), wait for them with a Monitor on `gh run view`, then read the
     data above. A valid candidate starts at 5% canary by itself at the next judge (2b5eba9).
   - **Uses:** what was learned is applied on the next form with that shape.
   - **Helps:** `filledShare`/`formsNeedingNothing` went up, and `missingShare`/`medianSeconds` went down, for the versions shipped.
   - **Without code:** the improvement on a target between two runs with **no code change in between** (same extension version, no landing) is the
     mechanism's own: compare the two scorecard rows and name the data that made it (a recipe gone canary, a meaning, a remembered kind, a used answer).
     Log each improvement as `data` or `code` in the scorecard's Mechanism table; the goal is a growing `data` share.
   - **Sees:** every left field has a reason the digest can group (not "unknown").
4. **Gaps:** any "no" above, and any number that cannot move. Examples:
   - a counter stuck at 0 while the thing happens live. First check that the fills are reaching the site at all: on 9 Oct, `proposedShare` was 0 because
     no fill from extension ≥0.9.126 (the version that counts suggestions) had reached the site yet, and the twin was cut off from it until d8cbe63. It was not a counting bug;
   - no comparison window: weekly and per-version rows are too thin (versions change about hourly, 1-2 forms each), so use the digest's recent vs earlier window
     (the last 3 days vs the 4 before; mac-1a, 9 Oct 2026) to see progress per weakness;
   - a weakness whose `area` names a part no data path can change (only code can).

   Each gap is a fix to the **mechanism**, not to a form, under the same rules: a failing test first, one change, land, then confirm the number moves in the digest.
   Keep the list in the scorecard (gap, evidence, status), and update the Notion design page's gaps section when one closes or a new one is found.
5. **Choose the round's work by impact:** the biggest form blocker (below) OR the biggest mechanism gap. A gap that hides or stops learning
   across all installs usually wins over one form. Say which you picked and why.
6. **AI spend:** a mechanism change that makes the AI see more, or run more often, is said in one line with its cost. Ask before raising spend.

## Fixing (the rules that make it worth it)
- **Read before guessing:** the timestamps in `app.log` usually give the cause outright (two steps racing, a floor refusing, a judge that saw the page too early).
  If the log can't tell, **add the missing log line first** (identity, never content), land it, and run the round again.
- **Universal only.** Name the shape, not the site: "email-first sign-up with no password box", "menu that ignores a scripted click", "required star at the label's start".
  Before writing code, say which part of the mechanism it improves:
  - an operator (`extension/page/*`);
  - the fingerprint;
  - a meaning in the alias pack;
  - a recipe;
  - an AI field with a fixed answer (`desktop/lib/page-kind.js`, `account-judge.js`);
  - noticing the miss.

  Never a site name, a word list or a per-site branch (`tools/hardcoded-page-words.mjs` guards this).
- **Judgments are the AI's.** Code only finds controls and keeps floors (never Submit, never a consent unless `accountAutomation` is full, one press per tab, never a password value).
- **One fix per change**, in its own worktree (`tools/worktree.sh <topic>`), with a test that **fails without it**. Prove that by running the test against main's file (the positive control).
  - Shapes: a fixture test (`desktop/e2e/test/*.test.mjs`, `worker/test/*`).
  - Form fixes: `cd desktop/e2e && npm run real-extension`, plus its control `REAL_EXTENSION_DIR=<old build>`.
  - **Every fix leaves its recorded page** (never fix the same site twice, CLAUDE.md): before landing, capture the page it fixes from the twin
    (`npm run twin:drive -- capture <tab> <case> <page> <your worktree>/desktop/e2e/recorded`), write `case.json` (shape, the AI answers the twin logged, `expect`),
    and see it fail with `REAL_EXTENSION_DIR=<old build> npm run recorded`, then pass. The push hook asks for it (`tools/recorded-cases.mjs`).
- **Extension version:** main + 1 (`git show origin/main:extension/manifest.json`), then `node desktop/scripts/extension-fingerprint.mjs --write` and `node desktop/scripts/codemap.mjs`.
- **Land:** `tools/ship.sh` (one change, one push), then `npm run twin:drive -- refresh` and check the new version is printed. Then run **the same target again** and compare its scorecard row.
  Run every other target once more too, before calling the round done: a fix for one must not break another.
- A change to a flow file (`FLOW_FILES` in `desktop/e2e/flows.mjs`) is covered by the flows matrix on CI. Don't run it locally per push.

## What is never ours
- **Submit** on an application.
- **A bot check:** the owner solves it in the twin's Chromium. Say so and move on to another target meanwhile.
- **An email or SMS code:** left to the person. Since 10 Oct 2026 the twin reads the owner's Gmail (read-only) for a sign-up's confirmation LINK; a code mail is still left to the person.
- **Consent boxes on the application form.**
- When a target reaches one of these, mark it in the scorecard and continue with the others.

## Reporting (after every round, and when stopped)
- **Data vs code:** how many of this round's improvements came from data (no code change) and how many from code, with each data one named.
- **The scorecard table** with a one-line delta per target (e.g. "Nahrin: account → code (Continue now pressed)").
- **What was fixed:** commit, version, the shape it covers, and which other sites and users it helps.
- **The mechanism:** its table with the trend since the loop started, the learns/uses/helps/sees verdict, gaps opened or closed.
- **What is next, and what waits on the owner** (a bot check, a code, a decision).
- **Run Log:** one Notion Run Log entry per session of the loop (signal only).
- **Bugs:** the Notion Bug Tracker row for each user-visible bug fixed.

## Stop when
- Every target is **ready** or waits on the person.
- Or two rounds in a row improved nothing (neither the forms nor the mechanism's numbers); then say what blocks it and ask.
- Or the owner says stop.

When stopping, tell the peers the twin is free, and leave it running (the owner may be looking).

# Record each site once, then work offline

> ✅ **Verdict:** a live visit is only for (1) a site's first recording, (2) a site that changed (a signal, never a schedule), (3) a route fix that needs
> the journey recorded further. Everything else (testing a fix, comparing builds, the regression check) is offline, $0.
> Most of the machinery exists (network record, replay, schedule, gate: `2026-10-13-replay-by-network.md`). Three things are missing:
> **A** the pool's role and name (it records, it does not test), **B** every rule that still asks for a live proof, **C** recording past the point where the extension stops.
>
> Status: **spec for cc's go (15 Oct 2026). Nothing built.** Session job-pilotto-cf, coordinator job-pilotto-cc. Owner, 14 Oct 2026: "We want to remove our dependency from live runs. We want to record the sites (one time) and then we do our job offline."

- **Why:** a fix to a route (a press the recording never made) cannot be replayed; so every such fix waited for a live run (2 visits a host a day, AI cost, a bot wall risk).
  The Aldi pool row stops after its own "Apply now" press: its old/new A/B needs a live run today.
- **Not built here:** "Confirmed offline" and the verdict "Our build / Site changed" (session job-pilotto-8e). This spec lands after it.

## History (read 14 Oct 2026)

| What | Shows |
|---|---|
| `7d83ce1`, `ca6f489` (12 Oct) | "Proven live" and "Proven only from live" were built 2 days ago, for a reason: a hand-made page proves a shape, not a real site |
| 13 Oct (`4ce0003`...`4a6da9b`) | network record + replay on PRs; the PR live proof (`pool-proof.yml`) and the flow canary were removed ("I don't want PR to generate an AI cost") |
| `eb8699a` (14 Oct) | rule already says "measure offline first; the pool only re-records" |
| `2272827`, `372a936` (14 Oct) | records on the private repo's release `net-records`; Linux replay; schedule + nightly gate (`720f1ad`) |
| `smoke.mjs` / `live-row.mjs` | a live row **presses nothing itself**: it records until the extension is quiet. A press the extension made but the site never answered inside the window ends the recording there |

So: reversing "Proven live" is the **last step** of a move that is mostly done. What it leaves unproven is the one thing the owner now names: a press the recording lacks.

## Part A: the pool becomes a recorder

| Today | After |
|---|---|
| The pool-running skill: "run live, did a site change under us" | `record-applying-sites`: record a NEW site once to its form; re-record only on a signal (below) |
| `pool-smoke.yml` "Pool smoke (by hand)" with a "proven live" record step | by hand, records only (`net-records-<run>` kept 14 days); no proven record |
| A fix is closed when the Fixed tab says "Proven live" | closed when it says "Confirmed offline" (8e) |
| Re-run the row live after a fix | never: replay it (`npm run row`), the PR replay and the schedule |

Skill name: verb + object + where. The old pool-running name no longer fits (it does not run a smoke); proposal **`record-applying-sites`**, old name to `RETIRED` in `desktop/test/skill-names.test.js`. Other skills that name it (`fix-recorded-sites`) updated in the same PR.

### Signals for a re-recording (never a schedule)
1. **Installs' outcomes.** Installs already report `flow_outcomes` (day, board, state, ai_family, n: `site/src/knowledge.js`, `formlearning.js`). A board whose reach drops against its own previous 14 days (e.g. filled share down by a stated amount, k ≥ 3 installs) raises "site may have changed" on `/admin/applying`; the coordinator re-records that board's pool rows (bounded: 3 live visits a host a day).
   - Counts and board names only; a host is never named from installs (k-anonymity: hosts listed from 3 installs). Board, not host, is the unit: say so on the page.
2. **A person's report** (the owner opens a row and sees a different page): a row's "Re-record" is a by-hand decision.
   - Decided (cc, 15 Oct): signal 1 goes **straight to a re-record** (a recording is one visit; a GET first adds a second).
   - k ≥ 3 per board covers few pool rows at first: `/admin/applying` shows **"no install signal"** on a row without one, so silence is never read as healthy; signal 2 (a person's report) stays visible there.
3. **Not a signal:** a replay that differs. Offline, a replay cannot see the site; it differs only when OUR build changed (8e's verdict "Our build"). The owner's wording "a replay that suddenly differs" is covered by that verdict; the "Site changed" half needs signal 1 or 2. 

## Part B: what still requires a live proof (list, keep/retire)

Land after 8e. "Retire" = the live-proof piece goes, the file's other duty stays.

| Where | What it says | Verdict |
|---|---|---|
| `.claude/skills/record-applying-sites/SKILL.md` "Proven live" bullet, hand-run bullets | proven records, Fixed tab "Proven live" | **retire**; rename skill (A) |
| same, "No live run on a PR" + "Testing is offline; the pool only RE-RECORDS" | already the target rule | **keep**, becomes the skill's lead |
| `.claude/skills/fix-recorded-sites/SKILL.md` description ("re-run to confirm it reached further"), lines 23, 162-164 | re-run live to confirm | **retire** the re-run; keep the `Pool-row:` trailer (it names the row for the fix ledger, not a live proof) |
| `docs/rules/applying.md` l.96 "Close a fix only when the Fixed tab shows ..." | live proof closes a fix | **change** to "Confirmed offline" |
| `docs/HOW-IT-RUNS.md` l.35 pool-smoke row | by hand, live | **change** wording: records |
| `site/src/applying-cases.js` header ("Proven comes only from the live layer") | the 12 Oct reversal | **retire** (8e rewrites the Fixed tab; I reword the comment) |
| `site/src/applying-proven.js`, `test/applying-proven.test.js`, `PUT /applying/proven` | store of proven records | **retire** after 8e's tab no longer reads it (keep old rows readable one release) |
| `desktop/e2e/pool-proven.mjs`, `lib/pool-proven.mjs`, `uploadProven` in `lib/applying-report.mjs`, `test/pool-proven.test.mjs`, `pool-smoke.yml` step "Send a proven live record", `tools/unproven-fixes*` | send / list proven | **retire** |
| `desktop/e2e/test/pool-ci-triggers.test.mjs` l.68-88 | guards that step | **retire** with it |
| `lib/site-ledger.mjs` ("a by-hand run uses 1 of 2 daily visits; the 2nd is kept for a PR proof"), `lib/engine.mjs` `PR_PROOF_ANTHROPIC_KEY` / kind `proof`, `pool-ai-cost.mjs` job `pr-live-proof`, `pool-ci-summary.mjs` proof branch, `captures.mjs` `pool-proof.yml` | leftovers of the removed PR proof (13 Oct) | **retire**: a by-hand run may use both daily visits |
| `desktop/e2e/measure.mjs` header "A fix is proven only by a live run" | | **change** |
| `fix-ledger.mjs`, `commit-trailers`, `recorded-cases` `Pool-row:` | links a fix to its row | **keep** |
| `docs/rules/why.md`, `site/public/intelligence.html` | incident history | **keep**, add the reversal as one line |
| Memory `feedback-live-proofs-in-pr-ci`, `project-pool-schedule-local-only` | live proof rules | **update** (mine, at landing) |

Guard (class test): one test lists the words `Proven live`, `live proof`, `pool-proof`, `proven live` over tracked files outside `why.md` and fails on a new one.

## Part C: full-journey recording

The gap: the harness presses nothing, so a route the extension did not take (or took and the site had not answered when the window ended) is absent. Replay is a fixed script of the live run; a new press = "unseen".

**Step 0 ($0, first, before any option):** is the Aldi stop a *short window* or a *missing press*? Read the Mac's existing Aldi record: is the "Apply now" request there, pending or failed? If pending, a longer wait for network quiet (record "settled" before ending) fixes this class with no driver at all. Cheapest first.

| Option | How | For | Against |
|---|---|---|---|
| **(a) Claude finishes during recording** (rung 5, `desktop/lib/ladder/rung5-takeover.js`) | after the extension is quiet and the page is not a form, the app's own ladder escalates once; the recorder keeps what it presses | universal (same escalation as the product's: "a dead end gets one escalating fallback"); no owner time; the record then holds the route the product would take | AI cost per row (measure; ~$0.06 an asked row today); **identity leak**: plan-path `claude -p` carries the owner's identity; must run with the fake applicant + the tripwire (a typed owner value deletes the capture); Claude's path is not the extension's: a route fix is proven only for routes Claude also took |
| **(b) A person clicks through once** in the twin, recorded | `npm run twin` + `twin:drive`; the recorder runs in the twin's browser | exact, $0 AI, no leak, handles odd pages | owner time; the twin's browser carries sign-ins (must not record them: the recorder never keeps cookies/headers, fine); on demand only since 14 Oct |
| (c) Harness presses by a script | | | forbidden: the harness presses nothing; a site-specific script is a site list |

**Recommendation:** Step 0, then **(a) as the default**, with the fake applicant, at most once per row (the takeover floor), and **(b) when (a) hits a wall** (login, captcha: stop, never go past) or the owner wants a specific route. One record format for both: same `netRecorder`, flagged `drive: extension | claude | person` in the record's `replay.json` so the replay and the verdict know which build's moves are in it.

Rules for both: never Submit, never captcha/bot check/login wall, never read a password field; 3 live visits a host a day (a recording is one visit); AI spend asked through cc with a measured cost; no site names or hosts in code, tests or fixtures.
**When the tripwire trips during (a):** the capture is deleted, the row keeps its old record, and it falls back to (b) (a person's click-through). Plan-path `claude -p` knows the owner's identity even with the fake applicant, so a trip is expected sometimes, not an outage.
**Identity (decided 15 Oct 2026):** no mechanism of this spec's own. #754's "never typed" checks the owner's values before a keystroke (inert without an owner list; the product cannot reach it) and probes the plan path's lean flag; recording through the app inherits it. The earlier "no recording runs its AI through the owner's account" rule is replaced by it. No API key on the Mac (owner).
**Safety floor for (a):** an owner value anywhere in a field → tripwire deletes the capture (exists: `privacy-tripwire.mjs`); the record is refused if the run used a profile that is not the fake applicant.

### First case: the Aldi row
Record it to its form (Step 0, then (a)); then replay old and new build offline and compare. Its live A/B stays on hold until this lands.

## An ask the recording does not have (from job-pilotto-50, after #755; 15 Oct 2026)
**The problem:** a recording keeps the site's network and the app's AI answers (the memo), keyed by the ask's body. A fix that changes what the app asks the model (new fields in a sketch, a new question) makes that ask a **miss**: the memo has the old ask's answer, not the new one. After #755 three rows (Databricks, the Greenhouse board form, coreweave) replay as "not faithful" for that reason only. If every ask change forces a re-record, "record once" is not true for the part that changes most.

**What a miss means, by cause** (the replay already tells them apart: `memoParts` names the one differing part):
| Cause | Today | Right answer |
|---|---|---|
| Only the system prompt or the seed changed, the ask's input is the same | a **loose hit**: the kept answer is used and counted as a warning (`looseHits`, `row-case-run.mjs`) | keep (this is option C, and it exists) |
| The ask's **input** changed because the fix changed it (a new field in the sketch, a new question) | a miss: "not faithful" | the old answer cannot judge the new ask; only a model can |
| The site changed | live visit needed | signal 1 or 2 (Part A), a re-record |

**Options for the second row:**
| Option | What it does | Cost | Against |
|---|---|---|---|
| A. A plan-path model call at replay time, **on the Mac only** | the missed ask is answered by `claude -p`, and the answer is **added to the row's memo** and published with the records, so the next replay hits | the plan path, no API key: about $0.06 a row asked (the pool's measured $0.056), one or two changed asks a row, so about $0.1 for the 3 rows above, **once per changed ask, not per replay** | the answer is not deterministic (live is not either); identity: the plan path carries the owner's identity, so #754's never-typed guard stays on and the replay uses the fake applicant; never on CI (no key) |
| B. CI marks the row "**ask changed: needs a local replay**" instead of "not faithful" | the gate does not fail, the verdict waits | $0, a label and a count | a fix that changes an ask has no CI verdict until someone replays on the Mac |
| C. Answers keyed by the ask's **meaning** | the memo key drops the parts that are not the ask's input (already done for the system prompt and seed: loose hits) | $0 | cannot cover a changed input: it would replay a stale answer and hide whether the new ask is answered right |

**Recommendation: B on CI, then A once on the Mac, as one mechanism.** CI says "ask changed: needs a local replay" ($0; the row is neither green nor "not faithful": its fix verdict is "waiting for a local replay"). The Mac then replays the row with the plan path for the missed asks only, **writes the new answers into the memo** and publishes it with the records (`records-publish.mjs`). From then on the row replays offline at $0 on CI too, with the new ask in its memo. The network record is never touched: "record once" holds for the site; only the model's answers grow, once per changed ask.
- **Not C for this case** (it exists for prompt-only changes and stays).
- **Floors:** the fake applicant, #754's guard and the tripwire on every plan-path call; no live site visit (the network is replayed); AI spend asked through cc with the measured cost, as for any paid run.
- **Not built.** Open for the owner: whether the Mac replay is by hand (`npm run row -- --fill-memo "<row>"`) or runs by itself after a merge that changed an ask (a trigger, never a schedule).

## Plan (PRs, each its own worktree `record-once-<part>`)
1. **PR 1, Part C step 0 + settle:** measure the Aldi record; if a short window, wait for network quiet before ending a recording (all rows). Test: a fake site whose answer arrives at +20 s.
2. **PR 2, Part C (a):** record-time takeover driver in the live row harness, flagged in the record, tripwire kept; test on a fixture shape (hand-made page, stub AI).
3. **PR 3, Part A:** rename skill, rewrite its lead, signal 1 on `/admin/applying` (needs a site-side query on `flow_outcomes`), pool-smoke.yml wording.
4. **PR 4, Part B** (after 8e lands): the retire list, the class test, memories.
5. The Aldi recording and the offline A/B (needs the owner's yes on the cost, via cc).

## Decisions (cc, 15 Oct 2026)
- Signal 1: straight to a re-record. PR 1-2 on fixtures at $0; a measured cost is asked before the real Aldi recording. Skill name `record-applying-sites`. PR 4 lands after 8e's PR is merged by the owner.

## Progress
- [x] History read; options weighed (proof: none: this spec)
- [x] cc's go (15 Oct 2026: spec PR + PR 1; PR 2 on fixtures) (proof: none: this spec)
- [x] PR 1: settle before ending a recording: an in-flight request is waited for (cap 20 s), the unfinished count is kept in record.json (proof: desktop/e2e/test/net-record.test.mjs). Found in code: a request still open at the end was never recorded.
- [x] PR 1b: Aldi recorded once (15 Oct 2026, 2 visits by mistake): the run ended while the extension was still deciding, 3 requests never answered; the recorder now says its visits, records unanswered kinds and runs on while deciding (proof: desktop/e2e/test/smoke-paths.test.mjs)
- [x] PR 2 (option a, Claude finishes the page) DROPPED: rung 5 starts a Claude CLI session on the person's own Chrome (`startClaude` → `apply.claudeOne`); the harness's test browser has no such command, driving it would be a new mechanism. The Aldi stop is not the extension's 8 s wait either: main fills a form inserted after a press answered 20 s late (proof: desktop/e2e/recorded/slow-answer-after-press-1/case.json)
- [x] PR 3a: skills renamed, fix skill trimmed, the filling-review skill folded in (proof: desktop/test/skill-names.test.js)
- [ ] PR 3b: signal 1 on /admin/applying
- [x] PR 4a: the e2e, workflow, tool, doc and skill pieces of the live proof retired, and a class test that fails on their return (proof: desktop/test/live-proof-retired.test.js)
- [x] PR 4b: the site's "Proven live" store, route and Fixed-tab column retired, the class test now covers site/ (proof: desktop/test/live-proof-retired.test.js); memories updated with cc's OK (14 Oct 2026). The applying_proven table stays unread until a later migration drops it
- [ ] Aldi recorded to its form; old vs new build compared offline

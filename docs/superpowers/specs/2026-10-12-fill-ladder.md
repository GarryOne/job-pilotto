# The fill ladder: after the extension fills, check it; when it is stuck, unblock it (owner's idea, 12 Oct 2026)

> **Verdict:** the **same rungs and the same router** (`extension/ladder/core.js`, unchanged), with **two new questions** for the fill stage:
> **`fill_verify`** (did each control take its value?) and **`fill_repair`** (which closed verb, on which numbered control, unblocks it?).
> Diagnose is not a third call: the repair answer names the widget kind and the verb together. **Repair changes HOW a value goes in, never WHAT:**
> the value is always the fill's own answer for that control; the model never writes a value. A repair that worked is kept per **structural
> fingerprint** (the recipe library that already exists), never per site.
> Status: **approved by the owner, 12 Oct 2026**; **amended 12 Oct 2026 (five owner changes, below): OK'd by the owner the same day**; built in the order A-E (Migration order).

| Key numbers | |
|---|---|
| New model questions | 2 (`fill_verify` at rung 2, `fill_repair` at rung 3) + rung 4 scope `verify` |
| Cost on a page with no miss | **0 calls** (rung 0 read-back only) |
| Cost on a page with misses | ≤ 1 small-model call (verify) + ≤ 1 per stuck control (repair, cap 3 per page); picture only when DOM can't tell |
| New stores | **none**: kept repairs go into the existing recipe path (`extension/recipe-schema.js`, `desktop/lib/recipes.js`) |
| PRs | 6, each with its proof (re-cut into A-E by the amendments below) |

## Amendments (12 Oct 2026, owner)
> **Verdict:** a stuck **control** enters the same ladder as a stuck **page**. Every try on a control (an operator's own retry or a repair) counts in
> **one log**, about 3 in all, never the same try twice; then the ladder climbs, then the person is told **once**. R0's read-back is **the one truth**
> the panel, the form judge and the app's card all read. Owner's words: "100 fixes in 48 hours and we still fail basic cases; I don't want 1000 websites in 1000 fixes."

| # | Change | Owner's live case | Lives in |
|---|---|---|---|
| 1 | **One attempt log per control** | (b) the 6th try in a row on one dropdown | `extension/page/attempts.js` (new) |
| 2 | **Verb `dismiss_layer`** | (a) a popup covers the fields, nothing fills | repair executor → `consent.js` `closeLayer` |
| 3 | **Value class** in `fill_verify` + `choose_option(i)` | (c) "+41" pushed into a Country dropdown | `extension/page/value-class.js` (new) |
| 4 | **One truth per control** | (d) CV uploaded, panel says "CV pending" | `page/fill-verify.js` R0 mark, read by panel, judge, card |
| 5 | **Same door, same learning, same switch** | all four | `extension/ladder/fill-climb.js` |
| 6 | **Zoo from real widget libraries** (owner via cc) | imitations pass, real widgets fail | `desktop/e2e/widget-zoo/` + vendored libraries |
| 7 | **Shadow with a score, acting in CI** (owner via cc) | "the passes ran" is not proof | `ladder-score` + the CI pool |

### 1 · One attempt log per control (case b)
| | Today | Amended |
|---|---|---|
| Who counts | each operator alone: retype `RETYPE_LIMIT` 5 (`browser-form-fastpath.js`), menu 2 attempts × 3 texts (`combo-click.js`, `fill-menus.js`), phone writings 2 (`format-retry.js`), real typing (`fill-verify.js`), the later pass clicks menus again; only repair was capped | **one log** per control, written by every operator's retry **and** by repair |
| A try | free to repeat | entry = (verb, control, **control state**: its value class, option count, shown/covered, error near it; never a value); the **same entry twice is refused** |
| Cap | sums to 6+ on one menu | **about 3 tries per control in all**; first measured (zoo + the CI pool's fill logs: tries per control today), then the number is fixed in code with the measurement in the commit |
| After the cap | the loop goes on | climb (R1 kept repair → R3 → R4) → the person, told **once**: the control's label + the reason class ("the site did not keep it after 3 tries") |
- `mayTry(control, verb)` before every retry, `tried(control, verb, worked)` after; a DOM mark `data-jobpilotto-tries` so every world (page kit, worker, panel) reads the same count.
- Log line: `fill: try <n>/<cap> <verb> on <widget>` (no label, no value).

### 2 · Verb `dismiss_layer` (case a)
- **What:** close button N of the layer **on top** (the sketch's ON TOP line: `on-top.js` `buttons`), through the existing path: `consent.js` `closeLayer` → `/extension/dismiss-popup` (`popup-pick.js`). The repair's button and popup-pick's pick must be **the same button**, else nothing is pressed.
- **Floors (AND):** a cookie, newsletter, promo or notice layer may be closed; a consent, declaration, terms, sign-in or bot check **never**; a layer that holds the form's own controls is the form (`on-top.js` already says so); never a button that agrees, subscribes, submits or sends (popup-pick's rule).
- **Trigger:** R0 reads a control as `unreachable` because the element drawn at its centre is another layer (hit-test), **or** the form judge says `blocked` (dialog / overlay).
- **Then:** the controls it covered get the fill's own answers again (each a try in the log). One dismiss per layer per page; a layer still there after its button = `contradicted` → climb, kept pick forgotten (`forgetDismiss`, exists).
- **Modes:** both, like today's popup gate before the fill (`popup-guard.js`).

### 3 · Value class (case c)
- **Fixed list in code**, validated at both ends: `dial_code` · `country_name` · `email_shaped` · `phone` · `date` · `number` · `url` · `free_text` · `none`.
- **Computed in the browser on the Mac** from the fill's answer for that control (dial codes: `page/dial-codes.js`; country names: `Intl.DisplayNames` over the same region table, no hand list; shapes for the rest). The model sees `answer: dial_code` per control, **never the value**.
- `fill_verify` may answer `wrong` + reason **`wrong_class`** (new, additive) when the class does not fit the label or the options (a dial code in Country).
- **Repair:** `choose_option(i)` by **number** from the control's own option list; validated locally: the option holds the answer's key parts (the digits of a dial code, the words of a name) or is the dial code's country by the local table ("+41" → CH → "Switzerland (+41)"). Anything else is refused.

### 4 · One truth per control (case d; also FNAC 12 Oct: judge "ready" with 2 required left)
- **One function gives each control's state, read live by every reader at its own moment** (`extension/page/read-back.js` stateOf): `committed | empty | mismatch | unknown`; the fill-end pass after settle also writes it on the control (`data-jobpilotto-r0`, plus `unreachable`) for the record and for debugging; no reader trusts a stale mark.
- **Every reader uses it:** the panel's left count (`review.js` `fields()`), the judges' sketch state + match (`account-fill.js` `accountSketch`), the fill trace (`trace-settle.js`) → the session's left/todo → the app's session card. No separate counts.
- **Upload slots by their own visible state:** `input.files`, **or** the file name the slot shows, the slot's chip or "uploaded" mark (by structure, near the slot; the extension knows the file it attached). Custom uploaders that clear `input.files` are read by what they show.
- **A slot R0 cannot read = `unknown`** → R4 scope `verify` (capped), never guessed.
- **Sources disagree** (panel vs trace vs judge) = the `contradicted` signal → climb; the screen shows one answer, never two.

### 5 · Same door, same learning, same switch criteria
- **Door:** a control that did not take (R0 after its tries) or that verify calls `wrong` / `unreachable` enters the ladder like a page dead end: a record `{level: 'control', rung, signal, reason, tried}` mirroring `core.js` (signals `stalled`, `contradicted`, `refused`, `unsure`, `failed`), climbed in `extension/ladder/fill-climb.js`. The page level's `deadEnd()` (`extension/ladder/dead-end.js`, job-pilotto-next-move, phase 2) is joined when it lands; never wiring in `fill-flow.js`.
- **Learning:** a kept repair per fingerprint (fingerprint → verb, option rule) travels in **next-move's feed**: the same batch to `/api/controls` (real use: source `user`; CI pool and replays: source `ci` / `replay` with `REPLAYS_PUBLISH_KEY`, one sender `ladder-moves.mjs`), as its own fixed-value array `repairs: [{fp, verb, ok, failed}]`; k ≥ 3, one miss drops. Repairs confirmed in the CI pool count. No second delivery path.
- **Switch-on criteria (as the page level):** no fixture source worse (`fv-*` / `fr-*` in `ladder-score`) · the wrong-and-confident list not longer · time per application within budget (clean page: R0 only, ≤ +1 s, measured) · cost per application shown to the owner and OK'd.
- **Endings (outcome contract, owner via cc, 12 Oct 2026; the list is next-move's, imported, never copied):** every left control names one fixed ending. Mine: **`blind`** (R0 cannot read it and R4 cannot settle it: recorded as fingerprint + what was missing, fixed values, never guessed); **`data_missing`** (a required control the fill had no answer for: a proposal row, asked once, rememberable; today a bare "no answer in the kit", 7 on the 20-row CI test); the control that used its tries names its ending too. Each with a zoo page that proves the ending.

### 6 · Zoo from real widget libraries (owner, 12 Oct 2026, relayed by cc)
- The 8 imitation pages stay. Beside them, zoo pages built from the **real open-source libraries** job forms use, **pinned versions vendored** into the repo (no network in CI): react-select, MUI Autocomplete, Select2, Chosen, flatpickr, intl-tel-input (the "+41" phone-country menu), a real drag-and-drop uploader (Dropzone or FilePond: the CV-pending case).
- **Which first: from data**, the count of each library's class names and data attributes in the pool's captures and evidence DOMs (counts said in the PR).
- Universal (libraries, never sites), deterministic, fast. Built inside PRs A-C: the uploader with A, the menus with B, intl-tel-input and flatpickr with C.

### 7 · Shadow with a score, acting in CI (owner, 12 Oct 2026, relayed by cc)
- **Score every `fill_verify` verdict:** against R0's read-back where R0 can read the control; for the rest, a hand-checked sample against the end screenshots (`end.png`). Report the precision of `empty` and `wrong` per source, plus the wrong-and-confident list.
- **In the CI pool** (fake applicant, held, never Submit) **repair acts**, so the unblock rate is measured end to end; shadow stays for users only.
- The short shadow stands (one zoo pass + one pool pass), but **switching on for users needs these scores against the switch criteria**, not only the passes having run.

## What I kept, changed and dropped from cc's proposal
| cc proposed | Verdict | Why |
|---|---|---|
| Same rungs + router, new question family | ✅ kept | `nextRung` is already question-agnostic; caps are the caller's (`desktop/lib/ladder.js`) |
| Verify rung 0 = read-back (#368), generalised | ✅ kept, **mostly exists** | operators already re-read (`page/controls.js` "returns {ok, why} after re-reading"), `page/typed-check.js` (#368), `page/menu-pick.js` `selectedAfter`, the fill trace's `outcome` + `CAUSES` (`extension/fill-card.js`). Missing: one pass **after the page settled** for every kind |
| Verify rung 1 = kept verdict per shape | 🔁 changed | a verdict about THIS run's values can't be kept. What can be kept is **how to read** a widget (its "on" attribute): that is a recipe's `onAttr` → rung 1 is the recipe library, shared by verify and repair |
| Verify rung 2 = sketch → ok / empty / wrong / unreachable | 🔁 changed | the judge sketches never carry values (privacy, `account-judge.js`). The model gets **state + local match** (`match: yes/no/unknown`, computed on the Mac from rung 0), never the value. "wrong" is decided locally or from the page's own error text |
| Verify rung 4 = screenshot reality check | ✅ kept, narrowed | only for controls rung 0 reads as `unknown` (custom toggles, chips, star pickers); typed values are already hidden in the picture |
| DIAGNOSE as its own step | ❌ merged | a second call doubles cost and latency; the repair schema carries `widget` (closed list) + `verb` |
| Rung 3 "NOT BUILT" | ⚠ corrected | rung 3 IS built for page outcomes (`desktop/lib/ladder/rung3-digest.js`, spec 2026-10-10 §4 ticked); `docs/flows/ladder.md` row 3 is stale (fixed in PR 1). What is new: a **control** digest beside the candidate digest |
| Verbs incl. `type`, `press key`, `scroll list` | 🔁 narrowed | `type` = re-type the fill's own answer (never model text); `press key` dropped (Enter can submit a form); `scroll list` folded into the select operator |
| Remember per structural shape at rung 1 | ✅ kept, **through recipes** | `escalation.json` keys by URL shape (`rung4-picture.js` `pageShape` = host + path: per site). Repairs go per control **fingerprint** (`page/skeleton.js`), locally first, then as evidence to the proposer: no second delivery path |
| Trailer values `fill-verify` / `fill-repair` | 🔁 changed | `Rung:` stays a number (`tools/rung-trailer.mjs` unchanged); the question is named by the fixture id prefix `fv-*` / `fr-*` |
| Rung 5 + 6 after a failed repair | ✅ kept | unchanged: once per application, on the person's press; the person card quotes the control's label and the reason class |

## The target graph (one page; amended 12 Oct 2026)
```
 extension fills the page (fill.js + operators)  ── unchanged: the fast tier ──
   every operator retry ──► ATTEMPT LOG per control (#1): same (verb, state) twice = refused,
                            ~3 tries per control in all, then climb
            │
            ▼
 ┌─ VERIFY ──────────────────────────────────────────────────────────────────┐
 │ R0 read-back after settle (every control, free) = THE ONE TRUTH (#4)     │
 │    per control: committed | empty | mismatch | unknown | unreachable     │
 │    written on the control; panel, judges, trace, app card read it        │
 │      all committed, no error text ───────────────────────────► done ──┐  │
 │      unknown (reader blind) ─► R1 recipe onAttr for fingerprint?      │  │
 │                                  yes ► re-read ► committed/empty      │  │
 │      still unknown, or sources disagree (contradicted) ─►             │  │
 │        R2 fill_verify (states, local match, VALUE CLASS #3; no values)│  │
 │          wrong (wrong_class) / empty / unreachable (covered)          │  │
 │          unsure on a choice or an upload slot ─► R4 scope verify      │  │
 └────── misses: empty / mismatch / wrong / unreachable ─► THE DOOR (#5) ┼──┘
            │      {level: control, rung, signal, reason, tried}          │
            ▼                                                            │
 ┌─ REPAIR (≤3 controls per page; tries count in the SAME attempt log) ─┼──┐
 │ R1 kept repair for this fingerprint? ─ yes ► execute ► R0 re-verify   │  │
 │ R3 fill_repair: numbered control digest ► {widget, verb, n, option}   │  │
 │    verb ∈ retype · trusted_click · choose_option(i) · toggle ·        │  │
 │           open_section · upload · commit(blur) · dismiss_layer(N) ·   │  │
 │           wait · ask_person                                           │  │
 │    floors AND ► execute with the extension's own primitive            │  │
 │    ► R0 re-verify ► committed? keep it (fingerprint → verb) ──────────┤  │
 │      kept repairs ► next-move's feed (/api/controls `repairs`)        │  │
 │ R4 closer look scope form (exists: click only, "put nothing in")      │  │
 └────────────── still missed ───────────────────────────────────────────┼──┘
            ▼                                                            │
 R5 Claude takeover (person's press / 5 s countdown, once per application)│
 R6 the person, told ONCE: "Phone: the site did not keep it after 3 tries"│
            ▼                                                            ▼
 form_ready judge (reads R0) ──► "Ready for your check" — Submit is ALWAYS the person's
```

## Per rung
| Rung | Question | Input | Fixed answers | Cost | Lives in | Today | New |
|---|---|---|---|---|---|---|---|
| 0 | did it take? | the DOM after settle (≥ 700 ms quiet) | `committed` · `empty` · `mismatch` · `unknown` | free | `extension/page/fill-verify.js` (new, page world) | `typed-check.js`, `browser-form-fastpath.js` retype, `menu-pick.js` selectedAfter, operators' re-read, trace `outcome` | one final pass for every kind; the trace row gains `committed` |
| 1 | how is this widget read / operated? | control fingerprint | a recipe (`OPERATORS`, `ON_ATTRS`) | free | `extension/recipe-schema.js`, `desktop/lib/recipes.js` | site library + canary, lookup by fingerprint | a **local** kept repair per fingerprint (`fill-repairs.json`, cache) + evidence to `/api/controls` |
| 2 | `fill_verify` | numbered controls: label · kind · required · state · `match` · error text near it · ON TOP line | per control `ok` · `empty` · `wrong` · `unreachable` · `unsure` + reason from `CAUSES` | small model (`page-kind.js` `MODEL`), ~1.5–3k in | `desktop/lib/ladder/fill-verify.js` (new) | `form-judge.js` judges the page, not each control | the per-control question; fixtures `fv-*` |
| 3 | `fill_repair` | the same numbered digest + the missed control's fingerprint skeleton (no text) + what was tried | `widget` ∈ WIDGETS, `verb` ∈ VERBS, `n` (control number), `option` (index into its listed options) | small model, ~2k in | `desktop/lib/ladder/rung3-controls.js` (new) + `extension/ladder/fill-repair.js` (new, executes) | page-outcome digest only (`rung3-digest.js`) | control digest; the executor maps verbs to existing primitives |
| 4 | is it really set? / one action | screenshot (typed values hidden) + sketch | verify: per numbered control `on`/`off`/`unsure`; repair: the existing `vetForm` click | strongest model, ~1.5k + sketch | `desktop/lib/ladder/rung4-picture.js` | scopes `account`, `page`, `form` (click when nothing filled) | scope `verify`; same caps (2 per shape, 10 a day) |
| 5 | Claude finishes | session | none | plan usage | `rung5-takeover.js` | yes, once per application | told which controls repair failed |
| 6 | the person | card | the control label + reason class | — | `renderer/` need-proposal, `application-journey.js` | generic "left" rows | the reason class on the row ("the site did not keep it") |

**WIDGETS** (closed; each maps to a primitive that exists): `text`, `masked_text` (phone/date mask), `native_select`, `custom_select` (react-select style), `typeahead` (async list), `segmented_toggle`, `checkbox_group`, `radio_group`, `date_picker`, `drop_zone`, `collapsed_section`, `trusted_click_only`, `other`.
**VERBS → primitive:** `retype` → fastpath retype (`browser-form-fastpath.js`) · `trusted_click` → debugger click (`combo-click.js`) · `choose_option` → `menu-pick.js` · `toggle` → `controls.js` toggle · `open_section` → `sections.js` · `upload` → `page/upload.js` · `commit` → focus-out on the same control · `dismiss_layer` → `consent.js` `closeLayer` (amendment 2) · `wait` · `ask_person`. No verb types model text, presses a key, or touches a control outside the digest.

## Triggers
| When | Rungs asked | Today |
|---|---|---|
| Every fill end | R0 | partly (typed boxes only) |
| R0 `unknown` on any control | R1 → R2 | none |
| `form_ready` says `needs_person` on a control the trace says filled (contradiction) | R2 | none (the panel trusts one or the other) |
| R0/R2 miss (`empty` / `mismatch` / `wrong` / `unreachable`) on a control we had an answer for | R1 → R3 → R4 | none |
| Fill put nothing in + required left (stuck) | R1 → R3 → R4 (exists from R4) | R4 click only (`fill-flow.js` ~401) |
| A control R0 reads as `unreachable` (hit-test: another layer at its centre), or the judge says `blocked` (dialog / overlay) | R3 `dismiss_layer` → refill the covered controls → R0 | popup gate before the fill only (`popup-guard.js`); after: logged |
| The answer's value class does not fit the control (a dial code in Country) | R2 `wrong_class` → R3 `choose_option(i)` | none: "+41" stays in Country |
| The panel, the trace or the judge disagree on a control (incl. an upload slot) | `contradicted` → R2 → R4 scope `verify` | each shows its own count ("CV pending" beside "uploaded") |
| A control used its tries (the attempt log's cap) | climb R1 → R3 → R4 → R6, the person told once | the operator's own limit, then silence or a loop |
| A control we had NO answer for | **not a trigger**: that is the answer pipeline's (`no_data`, `proposed`), never repair's | — |

## Caps and floors
- **Caps:** verify R2 once per page state; repair ≤ 3 controls per page; **every try on a control, an operator's or a repair's, counts in one attempt log: about 3 per control in all (measured, then fixed), never the same (verb, state) twice** (amendment 1); 1 repair loop per page state; R4 shares the existing caps (2 per shape, 10 a day). Every climb logs `ladder: rung N signal S` + `fill: <verb> on <widget>` (no text).
- **Floors (never move):** never Submit; never a consent, declaration or terms box (LEGAL); never a password field, never read one; never a bot check or SMS code; nothing outside the digest; one trusted click per control per page; no AI = nothing pressed beyond what the fill already does; a value is only ever the fill's own answer (or an option index the fill's option-pick chose).
- **Assistant mode:** `retype`, `commit`, `choose_option`, `toggle`, `upload` re-do the fill's own work → both modes. `trusted_click` on a non-field control, `open_section` → **"Do it for me" only** (owner, 12 Oct 2026).
- **Contradiction rule:** a kept repair that fails once is dropped (as `learning.js`).

## Privacy
- **Leaves the Mac in a verify/repair call:** labels, control kinds, states, the page's own error texts, option lists, a skeleton fingerprint. **Never** a typed value: the match is computed locally.
- **A screenshot (R4):** the visible page with typed values hidden (exists in `extension/ladder/rung4-picture.js`); choices the person made are visible as on/off (e.g. a gender radio) → R4 verify is only for widgets R0 can't read, and the Intelligence page gets the entry.
- **To the site:** fingerprint + verb + worked yes/no (counts), Technical reports switch honoured, k≥3. No label, no value.
- **Tests:** fake applicant only, through the harness; **plan path only** (Claude Code CLI), no API key on the Mac.

## How it is measured
- **Fixtures per question:** `fv-*` (sketch + rung 0 result → expected per-control verdicts) and `fr-*` (digest → expected widget + verb), beside the others in `desktop/e2e/ladder-fixtures/`, with stored answers; `npm run ladder-score` scores per question and per source; ratchet + prompt fingerprint cover them. Confidently-wrong traps: a toggle checked in DOM but not on screen; a value shown but reverted on blur; a consent the repair must refuse.
- **The widget zoo:** `desktop/e2e/fixtures/widget-zoo/` — one small page per WIDGET with a misbehaving variant (reverts on blur, ignores scripted click, async list, masked phone, chip toggle). Replayed with the real extension (`npm run real-extension`); each zoo page is also a recorded case that fails on the build before its PR.
- **Metric:** per control, `committed and matching` at the end of the fill, before vs after (rung 0 alone = the baseline; the ceiling = what Claude takeover reaches on the same zoo).
- **Ceiling run:** session **job-pilotto-fill-ladder-measure** runs the zoo + the regression pass rows (`next-round-briefs/regression-pass-2026-10-11.md`) on the plan path and reports: misses found by R0 vs R2, repairs that worked, calls and tokens per application.
- **Cost shown before it is spent:** the measure run prints tokens per application on the plan path; any API-path spend or a new model waits for the owner's OK.

## Migration order (≤ 6 PRs, each with its proof)
| # | PR | Proof |
|---|---|---|
| 1 | Safety net: widget zoo pages + `fv-`/`fr-` fixture format in `ladder-score` (offline), `ladder.md` row 3 corrected | zoo replays show today's misses as numbers (the baseline); score runs offline |
| 2 | R0: `page/fill-verify.js` final read-back after settle, trace `committed`, retype for every reverting kind | zoo cases `reverts-on-blur`, `chip-toggle-ignored` fail on old build |
| 3 | R2 `fill_verify` in **shadow mode** (asked, logged, nothing acts) + contradiction trigger | `fv-*` fixtures under the ratchet; a measure run's hit rate before any action |
| 4 | R3 `fill_repair`: control digest + executor over existing primitives, caps, floors | zoo cases fail on old; floor tests (consent, submit-like, password) refused; journey scenario |
| 5 | Remember: `fill-repairs.json` per fingerprint, one miss drops, evidence to `/api/controls` | second visit to the zoo page makes 0 model calls; `learning`-style test |
| 6 | R4 scope `verify` + person card reason class | trap fixture "checked in DOM, off on screen"; card render test |

`extension/fill-flow.js` is 418 lines: the wiring goes into a new `extension/ladder/fill-climb.js` from PR 2, never into fill-flow.js.

**Amended order (12 Oct 2026): PRs 2, 4, 5, 6 re-cut as A-E** (1 and 3 landed). One PR each, a proof in each, a recorded or zoo case that fails on main:
| PR | What | Proof (fails on main, passes after) |
|---|---|---|
| **A** | R0 final read-back after settle for **every** control kind (old PR 2) + **one truth** (#4): panel, form_ready, trace and the session card read the R0 mark; upload slots by their visible state | zoo `reverts-on-blur`, `chip-toggle`, `custom-uploader-clears-files`; a journey scenario where panel and card agree |
| **B** | The attempt log (#1): every operator retry + repair, ~3 per control, then the person once | zoo `menu-never-takes`: at most N tries, then one person row (main loops) |
| **C** | Repair (old PR 4) with `dismiss_layer` (#2) and value classes + `choose_option(i)` (#3); short shadow, then live | `fr-*` fixtures under the ratchet; zoo `popup-over-form`, `dial-code-in-country`; floor refusals (consent, submit-like, password) |
| **D** | Remember (old PR 5): kept repair per fingerprint, one miss drops, through next-move's feed (`repairs` array) | second visit to a zoo page: 0 model calls |
| **E** | R4 scope `verify` + the person card's reason class (old PR 6) | trap "checked in DOM, off on screen"; card render test |
Shadow (owner): one zoo pass + one pool pass with `fill_verify` logging, then repair goes live; a verb perfect on the zoo may go live directly. Every switch-on is reported to job-pilotto-cc first.

## Risks
| Risk | Guard |
|---|---|
| Loops (repair → re-render → repair) | caps per control/page/state; the re-verify is R0 only |
| Wrong action (clicks a consent, a submit-like button) | closed verbs, digest numbers only, LEGAL + Submit floors AND the answer, recorded refusal cases |
| A repair that "works" but sets a wrong value | the value is the fill's own; R0 checks match, not just "not empty" |
| Latency | R0 adds ≤ 1 s settle; model calls only on misses; the measure run reports seconds per application |
| Cost | 0 calls on a clean page; measured on the plan path and shown; never spent on the API path without the owner's OK |
| Layout-dependent verdicts (CI flakes, like ON TOP) | R0 is DOM state only; R4 never in CI cases |
| Kept repair poisons other sites | per fingerprint + local first; site only via the proposer + canary |

## What I would NOT build
- A separate ladder or router; a DIAGNOSE call of its own.
- Model-written values, free keystrokes, coordinates from the model.
- A kept **verdict** per shape (only how-to-read / how-to-operate is kept).
- Repairs per site or per URL shape; a second delivery path for learned repairs.
- Verify for controls we had no answer for (the answer pipeline owns those).
- R4 verify on every page "just to be sure".

## Owner decisions (12 Oct 2026: "go ahead" on the proposals)
1. The model sees states + a local match, never values: **yes**.
2. `trusted_click` / `open_section` in "Let me check each step": **off** ("Do it for me" only).
3. Shadow mode first (PR 3 logs only) before any repair acts: **yes**.
4. Relayed by job-pilotto-cc from the owner (12 Oct 2026, goal "as automatic, adaptable, dynamic and reliable as possible"): decision 2 **kept as landed**; shadow mode is **short**: one zoo pass + one pool pass with `fill_verify` logging, then repair goes live (PR 4); a repair verb that scores perfectly on the zoo may go live directly.

## Progress
- [x] Amendments 1-5 (12 Oct 2026): owner's OK (12 Oct 2026, in the fill-ladder window)
### 1. Safety net
- [x] Widget zoo pages (one per WIDGET, a misbehaving variant each): `desktop/e2e/widget-zoo/`, `npm run widget-zoo`, CI job widget-zoo (not required); baseline on main c7528b6: read 5/9, committed 2/9 (#423, #427)
- [ ] `fv-*` / `fr-*` fixture format scored per question by `ladder-score`, ratchet + fingerprint (fv-*: done in PR 3, 7 fixtures all exact on the plan path; fr-*: PR 4)
- [x] `docs/flows/ladder.md` row 3 corrected; fill questions added to the rung map (#423)
### 2. Verify rung 0 + one truth (PR A)
- [x] Library counts in the pool's saved pages (53 hosts: react-select 4, intl-tel-input 4, react-datepicker 3, react-dropzone 3 (Ashby's input carries its exact hidden style), Select2 2; MUI, Chosen, flatpickr, FilePond 0; recount from the CI artifacts with PR B); vendored real react-dropzone 14.2.3 page `drop-zone-react-dropzone-1` (amendment 6, PR A)
- [x] Final read-back after settle for every control kind (`extension/page/read-back.js` pass: ≥ 700 ms still, ≤ 2 s); the R0 mark `data-jobpilotto-r0` on each control; the fill's record takes it (PR A)
- [ ] Retype / re-pick for every kind that reverts (within the attempt log): text boxes done (#438, typed again key by key); choices, dates and the phone country part: PR B
- [x] Choices read `mismatch` (cc's review of #507): the fill marks its own pick (`data-jobpilotto-picked`, native and custom menus); another option shown = mismatch; a native menu the page set back is picked again within its attempt log (PR B). Custom menus (combobox) are re-armed only by a later pass today: their re-pick inside the log is next
- Known after PR A (cc's review, 12 Oct 2026): the record keys radios by group name (the last radio sets the reason text only); a judge "ready" over R0 `empty` (FNAC) is still logged only (PR 3's switch); the panel does not count a CV input hidden by `display:none` (real react-dropzone): the stacked PR
- [x] One truth: one reader for the panel, the judges' sketch (judge-sketch.js loads it), the fill's end read, the audit, coverage and upload; the session card is fed by the panel's report; upload slots read by the file they show; equivalence test vs the old copies: 5 named changes, 0 unnamed (PR A). With one reader the sources cannot disagree; R2's contradiction trigger (PR 3) stays. Found gap: a CV input hidden by `display:none` (real react-dropzone) is not counted by the panel at all: follow-up
### 3. Verify rung 2 (shadow)
- [x] `fill_verify` question, sketch without values, local `match` (`desktop/lib/ladder/fill-verify.js`, phase `fill` of /extension/account-judge)
- [x] Contradiction trigger (form_ready needs X, the fill's match says X kept) and the miss trigger (match no), logged only (`extension/form-ready.js`)
- [ ] Measure run: hit rate and tokens per application, shown to the owner (the ceiling run is job-pilotto-fill-quality's; shadow pass: zoo on the Mac done 12 Oct 2026 (`npm run widget-zoo -- --model`), pool in CI by cc's batch after 00:00 UTC 13 Oct on main >= 0.9.242)
- [ ] Score: every fill_verify verdict vs R0 (and a hand-checked end.png sample); precision of empty/wrong per source; wrong-and-confident list (amendment 7)
### 3b. The attempt log (PR B)
- [ ] Measure tries per control (the fill-end log line `tries per control`, counts only, PR B): zoo 14 pages: every control 1-2 tries, none needed 3; CAP = 3 stays until the CI pool's numbers (after-run) say otherwise
- [ ] Real-library menu pages (react-select, Select2, Chosen, MUI Autocomplete, by the counts) (amendment 6)
- [x] `page/attempts.js`: one log per control on the control itself; the fastpath's retype (was its own limit 5) and writings, real typing, menu openings, toggle presses and the generic operators all ask it; a try that failed on a state is not made again; CAP 3 in all; given up once (logged once, the record says why) (PR B)
### 4. Repair (PR C)
- [ ] Control digest (rung 3) + `fill_repair` schema (WIDGETS, VERBS incl. `dismiss_layer`, n, option)
- [ ] Value class (`page/value-class.js`, fixed list, both ends) in the fill_verify sketch; reason `wrong_class`; `choose_option(i)` validated locally
- [ ] Executor over existing primitives; caps; floor refusals tested (consent, declaration, terms, submit-like, password)
- [ ] intl-tel-input and flatpickr real-library pages (amendment 6); repair ACTS in the CI pool, unblock rate measured end to end (amendment 7)
- [ ] Wiring in `extension/ladder/fill-climb.js` (the door record; joins `deadEnd()` when it lands); journey scenario; zoo cases fail on old
### 5. Remember (PR D)
- [ ] Local kept repair per fingerprint, one miss drops
- [ ] Evidence (fingerprint, verb, worked) in next-move's feed: `repairs` array to `/api/controls` (real use + CI pool + replays), site stores it
### 6. Picture and the person (PR E)
- [ ] Rung 4 scope `verify` for unreadable widgets, capped
- [ ] Person card shows the reason class per left control
- [ ] Field-level endings (`blind`, `data_missing`, the try cap's), next-move's list, each proven by a zoo page

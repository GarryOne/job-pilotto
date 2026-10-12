# The fill ladder: after the extension fills, check it; when it is stuck, unblock it (owner's idea, 12 Oct 2026)

> **Verdict:** the **same rungs and the same router** (`extension/ladder/core.js`, unchanged), with **two new questions** for the fill stage:
> **`fill_verify`** (did each control take its value?) and **`fill_repair`** (which closed verb, on which numbered control, unblocks it?).
> Diagnose is not a third call: the repair answer names the widget kind and the verb together. **Repair changes HOW a value goes in, never WHAT:**
> the value is always the fill's own answer for that control; the model never writes a value. A repair that worked is kept per **structural
> fingerprint** (the recipe library that already exists), never per site.
> Status: **approved by the owner, 12 Oct 2026**; built in the order below.

| Key numbers | |
|---|---|
| New model questions | 2 (`fill_verify` at rung 2, `fill_repair` at rung 3) + rung 4 scope `verify` |
| Cost on a page with no miss | **0 calls** (rung 0 read-back only) |
| Cost on a page with misses | ≤ 1 small-model call (verify) + ≤ 1 per stuck control (repair, cap 3 per page); picture only when DOM can't tell |
| New stores | **none**: kept repairs go into the existing recipe path (`extension/recipe-schema.js`, `desktop/lib/recipes.js`) |
| PRs | 6, each with its proof |

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

## The target graph (one page)
```
 extension fills the page (fill.js + operators)            ── unchanged ──
            │
            ▼
 ┌─ VERIFY ──────────────────────────────────────────────────────────────────┐
 │ R0 read-back after settle (every control, free)                          │
 │    per control: committed | empty | mismatch | unknown  (+ page error?)  │
 │      all committed, no error text ───────────────────────────► done ──┐  │
 │      unknown (reader blind) ─► R1 recipe onAttr for fingerprint?      │  │
 │                                  yes ► re-read ► committed/empty      │  │
 │      still unknown, or form_ready says "needs X" while trace says     │  │
 │      X filled (contradiction) ─► R2 fill_verify (sketch, no values)   │  │
 │                                  unsure on a choice widget ─► R4      │  │
 │                                  picture (scope verify, capped)       │  │
 └────────────────────────── misses: empty / mismatch / unreachable ─────┼──┘
            │                                                            │
            ▼                                                            │
 ┌─ REPAIR (per missed control, ≤3 per page, ≤2 tries each) ────────────┼──┐
 │ R1 kept repair for this fingerprint? ─ yes ► execute ► R0 re-verify   │  │
 │ R3 fill_repair: numbered control digest ► {widget, verb, n}           │  │
 │    verb ∈ retype · trusted_click · choose_option(i) · toggle ·        │  │
 │           open_section · upload · commit(blur) · wait · ask_person    │  │
 │    floors AND ► execute with the extension's own primitive            │  │
 │    ► R0 re-verify ► committed? keep it (fingerprint → verb) ──────────┤  │
 │ R4 closer look scope form (exists: click only, "put nothing in")      │  │
 └────────────── still missed ───────────────────────────────────────────┼──┘
            ▼                                                            │
 R5 Claude takeover (person's press / 5 s countdown, once per application)│
 R6 the person: card "Phone: the site did not keep it (reverted)"        │
            ▼                                                            ▼
 form_ready judge (exists) ──► "Ready for your check" — Submit is ALWAYS the person's
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
**VERBS → primitive:** `retype` → fastpath retype (`browser-form-fastpath.js`) · `trusted_click` → debugger click (`combo-click.js`) · `choose_option` → `menu-pick.js` · `toggle` → `controls.js` toggle · `open_section` → `sections.js` · `upload` → `page/upload.js` · `commit` → focus-out on the same control · `wait` · `ask_person`. No verb types model text, presses a key, or touches a control outside the digest.

## Triggers
| When | Rungs asked | Today |
|---|---|---|
| Every fill end | R0 | partly (typed boxes only) |
| R0 `unknown` on any control | R1 → R2 | none |
| `form_ready` says `needs_person` on a control the trace says filled (contradiction) | R2 | none (the panel trusts one or the other) |
| R0/R2 miss (`empty` / `mismatch` / `wrong` / `unreachable`) on a control we had an answer for | R1 → R3 → R4 | none |
| Fill put nothing in + required left (stuck) | R1 → R3 → R4 (exists from R4) | R4 click only (`fill-flow.js` ~401) |
| A control we had NO answer for | **not a trigger**: that is the answer pipeline's (`no_data`, `proposed`), never repair's | — |

## Caps and floors
- **Caps:** verify R2 once per page state; repair ≤ 3 controls per page, ≤ 2 tries per control, 1 repair loop per page state; R4 shares the existing caps (2 per shape, 10 a day). Every climb logs `ladder: rung N signal S` + `fill: <verb> on <widget>` (no text).
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
### 1. Safety net
- [x] Widget zoo pages (one per WIDGET, a misbehaving variant each): `desktop/e2e/widget-zoo/`, `npm run widget-zoo`, CI job widget-zoo (not required); baseline on main c7528b6: read 5/9, committed 2/9 (#423, #427)
- [ ] `fv-*` / `fr-*` fixture format scored per question by `ladder-score`, ratchet + fingerprint (fv-*: done in PR 3, 7 fixtures all exact on the plan path; fr-*: PR 4)
- [x] `docs/flows/ladder.md` row 3 corrected; fill questions added to the rung map (#423)
### 2. Verify rung 0
- [ ] Final read-back after settle for every control kind; trace row `committed`
- [ ] Retype / re-pick for every kind that reverts (within the existing limit): text boxes done (#438, typed again key by key); choices, dates and the phone country part still open
### 3. Verify rung 2 (shadow)
- [x] `fill_verify` question, sketch without values, local `match` (`desktop/lib/ladder/fill-verify.js`, phase `fill` of /extension/account-judge)
- [x] Contradiction trigger (form_ready needs X, the fill's match says X kept) and the miss trigger (match no), logged only (`extension/form-ready.js`)
- [ ] Measure run: hit rate and tokens per application, shown to the owner (the ceiling run is job-pilotto-fill-quality's; shadow pass: zoo on the Mac done 12 Oct 2026 (`npm run widget-zoo -- --model`), pool in CI by cc's batch after 00:00 UTC 13 Oct on main >= 0.9.242)
### 4. Repair
- [ ] Control digest (rung 3) + `fill_repair` schema (WIDGETS, VERBS, n, option)
- [ ] Executor over existing primitives; caps; floor refusals tested
- [ ] Wiring in `extension/ladder/fill-climb.js`; journey scenario; zoo cases fail on old
### 5. Remember
- [ ] Local kept repair per fingerprint, one miss drops
- [ ] Evidence (fingerprint, verb, worked) to the proposer via `/api/controls`
### 6. Picture and the person
- [ ] Rung 4 scope `verify` for unreadable widgets, capped
- [ ] Person card shows the reason class per left control

# Base facts: one home per fact, the right control per question (17 Oct 2026)

Owner-approved sketch (the review copy, an Artifact): https://claude.ai/artifact/ThL9fc3vfDZSVMkiSvNT8e. This file is the sessions' checklist.

## Owner's decisions (17 Oct 2026, relayed by job-pilotto-cc with his exact words)
1. Homes, "Yes, combined version" (replaces "three homes as sketched"): **Profile → Your details** = facts, in 3 sections: Contact (identity,
   contact, links), Work eligibility (authorisation by country, sponsorship), Availability & compensation (notice, the salary expectation
   stated to employers, per country), plus languages and experience. **Search strategy** (Strategy renamed in the sidebar, wizard and ⌘K) =
   what jobs to find: roles, locations, relocation, work modes, MINIMUM salary, level (+ Suggestions / Scoring tabs). **Profile → Application
   answers** = extra reusable answers + website-specific exceptions. **The Preferences tab is removed** once its fields have moved. One source
   per value: forms read authorisation, notice and contact from Your details, never a duplicate editable answer. Two salaries stay apart:
   "Minimum acceptable salary" filters jobs, "Salary expectation shared with employers" fills forms; changing one never overwrites the other.
2. Role priorities and Seniority move from Preferences to Search strategy: "Yes, move to Strategy".
3. Gender in surveys: "Ask once", default "Decline to self-identify". Pronouns give Title / Salutation, never gender.
4. Contradictions between copies: "Show me, I pick": one "Which is right?" screen in the migration, nothing auto-picked.
5. A new reusable question becomes a standard answer when "Seen twice, auto": 1st employer = kept on that job + quiet candidate;
   2nd employer (same topic, any wording) = promoted with the answer given, "✓ Remembered for future forms · Undo" (+ "only this job").
6. Answer once is an inbox, not a store: each item is written to its home (Your details / Search strategy / Application answers); one-job
   questions go to that job's drawer; consent to the setting (#1147).

- **Profile tabs** (owner, 17 Oct 2026: "CV separate, Experience separate too"): **CV** (current CV, preview/replace, CV check, "Your CV changed") · **Experience** (extra CVs, LinkedIn export) · **Your details** (Contact incl. name, salutation, email, phone, address, date of birth, links · Work eligibility · Availability & compensation · languages) · **Application answers** · **Cover letter**. Preferences removed; "CV & details" splits into CV + Your details.
- **Rule change for PR 2** (owner, 17 Oct 2026: "Why 'A choice (visa, relocation, demographic, any knockout)' is left for me? We should have this information in the Profile, as a standard/base."): docs/rules/applying.md lines 46 and 51: a choice a base fact answers is FILLED from the Profile (the AI maps the fact to one of the form's options, validated); an unsure match is left and goes to Answer once; demographics are filled from the answer given once; a choice no fact covers is left; certify/attest stays the person's; never Submit. Quote in applying.md and why.md. Tests: fact → option across languages; unsure → left; certify never touched.

## Measured (read-only, 17 Oct 2026)
59 forms (22 of the owner's Agent Runs with a field table, 37 pool captures), 426 distinct wordings → 39 topics. ~17 base facts cover 78%;
consent 4%; job-specific 6%; junk / passwords 10%; extras 1%. His answers page: 57 rows → 21 base, 25 deduced, 3 settings, 6 kit or one job,
1 extra, 1 junk; his 9 open rows → 1. Five contradictions between copies (nationality, place, street, notice, a test salutation).

## How a question's kind is kept (PR 1)
- Kinds: `text`, `long_text`, `single`, `multi`, `yes_no` (`desktop/renderer/question-kind.js`, pure). From the fill's own field type
  (`extension/page/fill-read.js`: select / radio / combobox → single, multiple or checkbox-group → multi, checkbox → yes_no, textarea → long_text).
- In the store: a mark at the end of the question's line or cell, the same text on every adapter: `Title: ❓ (asked by Adnovum) [pick one: Mr | Mrs | Ms]`,
  answered `Title: Mr [pick one: Mr | Mrs | Ms]`. Text questions carry no mark. Short option lists only (≤ 8 options, ≤ 160 characters);
  a long menu (a country list) keeps its options in `settings.questionFormats` on this Mac (rebuildable form structure, refreshed by every fill).
- Old rows with no mark: the AI judges the kind from the label once (fixed answer, validated), cached in `settings.questionFormats`.
  The person changes it in the row; that change writes the mark to the store. Store mark > fill > AI.
- The saved answer is the meaning: the answers call maps it to each form's own options (worker `FACT_RULE`: "Choose the form's own option
  that means that answer, in whatever language"). The mark is never a constraint on another site.

## Progress
- [x] Sketch measured and approved (Artifact above) (proof: none: an owner decision relayed by job-pilotto-cc on 17 Oct 2026, quoted under "Owner's decisions")
- [ ] PR 1: controls per kind (store mark, fill options in the trace, shared control in Answer once + Needs review, AI kind for old rows, cross-site proof)
- Cross-site proof (PR 1, plan path, $0, 5 runs): saved English answers (Mr, Switzerland, Yes) filled a German/French form's own options: Herr, M., Ja typed 5/5; "Suisse" chosen 4/5 but only **proposed**: the grounding floor (worker/src/answer-facts.js floorUngrounded) compares words, and "Suisse" is not a word of the profile ("Switzerland"). PR 2 makes it compare meanings.
- [ ] PR 2: topics + deduce from base facts (extends `covered_by` with a fact + deduced value validated against the form's options), "seen twice" lifecycle, Answer once as inbox with homes
- [ ] PR 3: one home per value (Your details in 3 sections; Search strategy rename + relocation, work modes, minimum salary, level; Preferences tab removed; two salaries apart), migration with "Which is right?", one test over every questionnaire screen

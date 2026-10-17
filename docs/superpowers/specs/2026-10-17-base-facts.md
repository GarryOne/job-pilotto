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
7. Preferences content split by meaning (owner, 17 Oct 2026, 3c.2): "Professional summary → Profile → Experience → Professional summary;
   Strengths and expertise → Profile → Experience → Strengths; Deal-breakers: no on-call, excluded industries, travel limits → Strategy → Criteria
   → Deal-breakers; Desired roles, locations, work arrangements and minimum salary → Strategy → Criteria; Personal facts, eligibility and
   availability → Profile → Your details." Experience shows "a short preview with Edit, rather than hiding it entirely or displaying a large
   textarea". Strategy tells apart "Preferences: improve a job's ranking" and "Must-haves / deal-breakers: determine whether it is acceptable".
   "Scoring can read both your professional background and your job preferences without duplicating their editors."
8. Locations, one source (owner, 17 Oct 2026, 3c.2: "Aim for one source of truth, but don't blindly merge two lists that might mean different
   things"): where you live → Your details; where you want to work / would relocate → Strategy → Criteria → Locations; where crawlers search →
   derived from those, with optional advanced overrides. Keep preferred, acceptable, relocation and remote apart; compare the existing values in
   the move and ask once on a conflict, never discard or combine silently; no automatic re-score: future scoring uses the new preferences, old
   scores are marked "based on previous preferences" with an explicit refresh for active jobs. "Changing where a preference is stored shouldn't
   itself trigger expensive AI work if its meaning hasn't changed."

- **Profile tabs** (owner, 17 Oct 2026: "CV separate, Experience separate too"): **CV** (current CV, preview/replace, CV check, "Your CV changed") · **Experience** (extra CVs, LinkedIn export) · **Your details** (Contact incl. name, salutation, email, phone, address, date of birth, links · Work eligibility · Availability & compensation · languages) · **Application answers** · **Cover letter**. Preferences removed; "CV & details" splits into CV + Your details.
- **Rule change for PR 2** (owner, 17 Oct 2026: "Why 'A choice (visa, relocation, demographic, any knockout)' is left for me? We should have this information in the Profile, as a standard/base."): docs/rules/applying.md lines 46 and 51: a choice a base fact answers is FILLED from the Profile (the AI maps the fact to one of the form's options, validated); an unsure match is left and goes to Answer once; demographics are filled from the answer given once; a choice no fact covers is left; certify/attest stays the person's; never Submit. Quote in applying.md and why.md. Tests: fact → option across languages; unsure → left; certify never touched.

- **Decision 9, Job preferences** (owner, 17 Oct 2026, on the 3c.2 plan: "The proposal is largely right"): final Profile tabs "CV · Your details ·
  Experience · Application answers · Cover letter"; deal-breakers "in Strategy, alongside job preferences. Clearly distinguish strict requirements from
  preferences that influence ranking"; the card is "Job preferences" ("It includes priorities, not only acceptance conditions"); collapsed rules show
  "a summary of active rules, such as 'No on-call · Exclude recruitment agencies · 2 more'"; the employer-facing salary expectation stays in Your
  details and Application answers reuse it, the minimum stays in Strategy; duplicate location lists: "Merge true duplicates; keep deliberate search
  overrides under Advanced"; old Preferences links: "Redirect field-specific links to their new editor. General Preferences links can open Strategy."

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

### 1. Sketch and question kinds
- [x] Sketch measured and approved (Artifact above) (proof: none: an owner decision relayed by job-pilotto-cc on 17 Oct 2026, quoted under "Owner's decisions")
- [x] Controls per kind: store mark, fill options in the trace, shared control in Answer once + Needs review, AI kind for old rows (proof: desktop/test/question-kind.test.js @646619e)
- Cross-site proof (plan path, $0, 5 runs): saved English answers (Mr, Switzerland, Yes) filled a German/French form's own options: Herr, M., Ja typed 5/5; "Suisse" then only proposed, fixed in item 2.

### 2. Answers from base facts
- [x] A choice a base fact answers is filled from the Profile, in any language (rule f) (proof: worker/test/choice-from-fact.test.js @7013379)
- [x] Deduce: a saved answer settles a question in other words or by what it implies; the proposal is one of the row's options or none; a changed saved answer is judged again (proof: desktop/test/question-lists.test.js @dbdd709)
- [x] "Seen twice": 1st employer = kept on that job + quiet candidate (the typed answer: Form knowledge, 949c83c); 2nd employer, same topic = promoted, "✓ Remembered for future forms · Undo" (proof: desktop/test/seen-twice.test.js @dad6cfa)
- [x] Answer once as inbox: each answer written to its home (Your details / Application answers / the job's drawer) (proof: desktop/test/answer-home.test.js)

### 3. One home per value
- [x] Profile tabs: CV and Your details apart; ⌘K reaches every tab and section; Strategy titled "Search strategy" (proof: desktop/test/profile-tab-split.test.js @24817c7)
- [x] Your details gains Work eligibility, Availability & compensation, Languages on every store (proof: desktop/test/profile-sections.test.js @134bc4c)
- [x] The one-time move: copy + backup first, word for word, nothing removed before its line reads back, every value checked after; "Which is right?" picks, never auto (proof: desktop/test/profile-move.test.js @134bc4c)
- [x] Strategy shows permit and languages read-only ("Edit in Your details"); relocation, work modes, minimum salary, level; two salaries apart (proof: tests/test_desktop.py)
- [x] Experience → Professional summary and Strengths: a short preview with Edit, saved line by line on every store (proof: desktop/test/experience-profile.test.js)
- [x] Preferences tab removed; its old name opens Strategy → Job preferences; education, role history and unknown sections on Experience, voluntary surveys on Your details, every template heading with a home (proof: desktop/test/experience-profile.test.js)
- [x] Cover-letter style moves to the Cover letter tab (the letter prompts keep the style rules) (proof: desktop/test/letter-style.test.js)
- [x] Notion template: each section names its one editor in the app; the page keeps its title (owner, 17 Oct 2026: "Keep title") (proof: docs/notion-profile-template.md)
- [ ] Locations, one source: Strategy's preferred / acceptable / relocation / remote feed discovery and scoring; a conflict asked once in the move; old scores marked, explicit refresh, no automatic re-score
- [x] Experience tab as folded cards: sources first, roles only in the job cards, Strengths as rows, notes small (owner, 17 Oct 2026: "collapsed, it should be using cards"; "Just duplicating data") (proof: desktop/test/experience-cards.test.js)
- [x] Application answers from the owner's mockup: All · Needs review · Saved, a review banner, one Saved answers card, rows edited in place, "Answer as" under Advanced options, the page intro never as answers (owner, 17 Oct 2026: "Make it look like this") (proof: desktop/test/answers-layout.test.js)
- [ ] Application answers rows link to their home (Your details ↗ / Strategy ↗); Eligibility, Availability and Links read from Your details (owner, 17 Oct 2026: "Layout now, links next")
- [x] Jobs' Answer once becomes one compact card ("Application questions", the review queue's count) and the questions are answered one at a time in a right drawer (job drawer slot; Back · Skip for now · Confirm & next; selector, set-aside apart, drafts kept), opened from Jobs, Profile → Application answers and ⌘K (owner, 17 Oct 2026: "THIS IS TOO CROWDED/OVERWHELMING"; sketch decisions all recommended) (proof: desktop/test/question-review.test.js)
- [ ] Review drawer, part 2: "date" and "amount + currency" kinds (field type, else the AI's one judgment); a date question that also asks about constraints needs "Add constraints" or "No constraints"; "Reuse for matching questions" off = this job only (owner, 17 Oct 2026: "Add date + amount", "This job only")
- [ ] One test over every questionnaire screen
- [x] Strategy → Job preferences: Must-haves & deal-breakers apart from Preferences (ranking), rules folded under a summary, Add a deal-breaker / preference; the Profile tab keeps only lines with no other home (proof: desktop/test/job-preferences.test.js)

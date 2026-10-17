# Locations, one source (17 Oct 2026)

Part of [base facts](2026-10-17-base-facts.md) decisions 1, 8, 9. Owner-approved sketch: https://claude.ai/artifact/P5bS5vMLYKMgr5dNJc4bZA, with the owner's corrections below (17 Oct 2026, his words quoted).

## Model
Strategy → Locations is the one source: **Preferred** (ranks higher), **Acceptable** (valid, not first), **Relocation** (Yes / No / Not specified + destinations), **Remote work** ("Jobs that allow working from <where you live>"; geographic search exclusions stay a separate list).
Where you live and work rights stay in Your details. Crawl places are derived: Preferred + Acceptable (+ relocation destinations only when relocation is Yes). An override is an explicit Advanced choice.

## Owner's corrections (17 Oct 2026)
1. Connect the consumers (crawl, scoring) **before** removing the old editors: no state where the editor and the behaviour disagree.
2. Conflicts: show both values, **no preselected winner**. Options: Use Profile value / Use Strategy value / Choose locations; "Use different locations for searching" is an explicit advanced option, never the default. Matching values migrate automatically.
3. Unset ≠ meaningful: "No relocation", "Anywhere" and an intentionally empty selection are values; use the populated side only when the other is genuinely unset. Relocation keeps Yes / No / Not specified; ask when intent is unclear.
4. "Remote work" wording as above, not "Remote eligibility: Counts · not from …".
5. An active search override shows on the card while Advanced is collapsed: "Custom search coverage active · <places>" + "Reset to preferences".
Both originals are kept until the person confirms. Cost estimate shown only when calculated, else "cost unavailable"; old scores are not rescored *automatically* (refresh is explicit, active jobs). A move that keeps meaning marks nothing and spends nothing.

## Progress
- [x] a. Model + one-time move (#1221, #1223): read both sides, classify (same / one unset / conflict), backup, conflict step with the options above, read-back (proof: desktop/test/locations-move.test.js @3a7cac2)
- [x] b. Consumers: crawl derived from Locations, scoring reads it, scores marked "based on previous preferences", explicit refresh for active jobs, per-job mark in the drawer (#1234, #1242, #1249) (proof: tests/test_locations_search.py @0be8837, tests/test_score_locations.py @c3f7867, desktop/test/locations-drawer.test.js @c3f7867)
- [x] c. Strategy → Locations card (⌘K), Preferences location rows removed, override visible when collapsed (#1255) (proof: desktop/test/locations-card.test.js @5c32fba, desktop/test/locations-model.test.js @5c32fba, tests/test_strategy_locations.py @5c32fba)
- [ ] Open: Home base → Your details needs a profile-move step like 3b (it stays in Job preferences); the Workload rule still reads the Profile's Countries text

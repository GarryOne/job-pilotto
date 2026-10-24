# Fill gaps the bake-off found, and what it did not test

> [!IMPORTANT]
> **Verdict (owner's question, 14 Oct 2026: "do we have room for improvement?"): yes.** On the 5 live forms every tool ran, the extension (latest main, the Hadrian-shape regression fixed) fills **31 of 62 required fields right, 0 wrong** (50%; the open-source agents 33–42%). About **13 of the 31 empty ones are real gaps** (up to ~70%), and the agents already fill some of them. The benchmark also **never tested** account creation, multi-page wizards on live sites or posting-to-form flows.

**Why:** the bake-off (extension vs Stagehand, Browser Use, Nanobrowser; private repo `GarryOne/jobadabra-bakeoff`, its `README.md` and `QA.md`) ends with a score; this spec turns its misses into work. Raw data per field: that repo's `results/runs/*/judged.json`.

## The 31 empty required fields (latest main, regression fixed)

| Why empty | Count | Ours to fix? |
|---|---|---|
| The fake applicant's facts do not answer it (notice period, start date, "why us", live-coding, team hours, C++ build systems…) | 13 | no: a real profile answers several (the grown applicant has notice and start date) |
| By design: a consent checkbox on the application form | 3 | no (the person ticks it) |
| Benchmark artefact: a CV upload the safety guard blocked; a duplicate name control the reader saw | 2 | no |
| **Real gaps: the facts answer it, we left it empty** | **13** | **yes** |

## The real gaps, by shape (no site names: shapes only)

| Shape | Seen on | An agent filled it | Note |
|---|---|---|---|
| **Salary / desired pay** (text or number, sometimes "in USD") | Teamtailor (own domain), Recruitee (own domain) | ✅ all three agents | we only *propose* salary for the person to confirm: decide whether a required salary with a known target is typed (with the currency the field asks) |
| **Location / address autocomplete** | Lever "Current location", Teamtailor "Address" (suggest-only) | ✅ Browser Use, Nanobrowser | a typeahead that offers no matching choice; the old build gave up after 16 s; the agents typed a plain value |
| **Yes/no screening questions answerable from the CV** | Breezy (7 radios) | ✅ Nanobrowser (2) | "hands-on Python or Go?", "built backend services?": the CV facts say yes |
| **Sponsorship** | Lever | ✅ Nanobrowser | facts: EU citizen, no sponsorship needed |
| **Years with a named tool** | Teamtailor (Terraform), Recruitee (IaC) | none | the CV lists the tool and 8 years |
| **Work history (long text)** | Breezy | none | the CV has the jobs |
| **A required link field** | Recruitee "Useful links (e.g. GitHub)" | none | only LinkedIn is known: is it acceptable? |

## What the bake-off did not test

| Not tested | Why | What would test it |
|---|---|---|
| **Account creation / sign-in flows** (Workday, SuccessFactors) | the safety guard aborts every write and live visits are by hand only; a "steps yes, final submit no" rule is weaker | an owner decision on test accounts + a submit detector; or offline replays of recorded account flows |
| **Live multi-page wizards** | none of the live forms was multi-page | the local 5-step wizard exists (our extension 8/11 required right; the agents not run) |
| **Posting → Apply → form flows, redirects** | prepared, not run (budget) | 6 posting-start forms listed (Workable, Join, Personio, Teamtailor, Lever, Ashby) |
| **The commercial leader (Simplify)** | needs the owner by hand | the bake-off's console snippet + scorer |

## Hardest forms tested
- **By size:** Teamtailor on its own domain: 16 required controls (suggest-only address, a date, several free texts, a presigned CV upload). Ours 9/16, Browser Use 11/16 (the only form an agent clearly beat us), Nanobrowser 10/16, Stagehand 2/16. It also exposed the `5afa5a8` stall.
- **By fill rate:** Recruitee (fresh form): open-ended required questions; every tool ≤2/7.
- **Most required controls:** Breezy: 17–18 required, 7 yes/no; best 9/18 (ours).

## Progress
- [ ] Salary: decide (owner) whether a required salary field with a known target is typed or stays a proposal; then a recorded/zoo case per shape (text, number in another currency)
- [ ] Location/address typeahead with no matching choice: a fallback (type the plain value, move on) + a zoo case (the bake-off's `fixture/combo.html` shape)
- [ ] Yes/no screening answered from CV facts: the AI's fixed answer covers yes/no radios; a recorded case
- [ ] Sponsorship and "years with <tool>" answered from the profile/CV: recorded cases
- [ ] Work history long text from the CV: a recorded case
- [ ] Each fix lands with a case that fails on the old code (the normal rule) and expected values per field (check 3 of the measuring work, #650)
- [ ] Re-run the bake-off QA (`qa.mjs compare`) on the build with the fixes: the 50% moves
- [ ] Not-tested areas: the owner decides which one comes next (account flows, live wizards, posting-start flows, Simplify)

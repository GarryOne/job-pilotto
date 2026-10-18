# A search that learns where jobs are (any role, any place)

Owner, 18 Oct 2026: "Let's improve the search, the algorithm, the intelligence of it. It should be innovative, creative, self-adaptive... Let's make
it find jobs for each of these roles in these locations" + "and from as many 'find jobs' runs as possible". Sketch and BEFORE numbers:
https://claude.ai/artifact/NMRWL19DJuwXqFiid66qny (session job-pilotto-personas, coordinator job-pilotto-d2).

## Owner's decisions (18 Oct 2026, AskUserQuestion)
1. **Widening:** extra local-language search phrases and nearby towns are added automatically and shown in the log; a change to the user's own
   role list stays a proposal they accept.
2. **Sharing:** counts per source host × role family × country (fixed lists), k ≥ 3; a search phrase only when 3+ installs used the same one
   (as the meanings pack). No free text.
3. **Board ideas:** the main model (one call when places or roles change), not Haiku.
4. **Go:** 7 PRs; PR 1 + PR 7 in job-pilotto-personas, PR 2, 3, 4 in parallel sessions, PR 5 and 6 after PR 1.

## BEFORE (run 1 on build 46573c7; fictional CVs; the persona harness)
| Persona | Matched in places | Fit ≥ 70 | Digest | Top 10 right | Where the jobs came from |
|---|---|---|---|---|---|
| Finance, Amsterdam | 75 | 2 | 10 | ~6 | employer feeds; 2 Dutch boards gave 0 |
| Music, Berlin | 17 | 0 | 1 | 1 | "creative" feeds = video/social; XING 38 read, 1 audio job |
| Driver, Nuremberg | 48 (press 2) | 24 | 10 | (to judge) | XING 30 real CE jobs, all "via XING Jobs"; 7 warehouse from feeds |

## Target, proven with the persona harness before/after each PR
Each persona: ≥ 10 relevant jobs in or near the city in the digest, ≥ 7 of the top 10 right on role, place, language and level; relevant jobs go
up press by press; the SRE control (e2e fixture CV, Zurich) no worse. Harness: `tools/persona-search/` (PR 1 brings it in; until then the copy in
the personas session's scratchpad).

## Who owns what
- **job-pilotto-fc owns the employer-discovery queue** (scout candidates: yield order instead of the 100-name pause, expiry of dead sources, country
  lists only for their own country, Wikidata small companies, role search #1323, "paste any page"). Nobody else changes its ordering.
- This spec owns every other path to jobs: boards, structural readers, yield, widening, cross-install ranking.

## The PRs
| PR | Concern | Session | After |
|---|---|---|---|
| 1 | **Yield per source**: each run records per source (kind, name, host): open jobs, in places, new, scored, fit ≥ 70 (`source_yield` in the job cache); one log line "Where your jobs came from"; persona harness in `tools/` | personas | – |
| 2 | **Boards for everyone, by yield**: the "Searching job boards" step reads the found boards for any country (not only jobs.ch / SwissDevJobs / TechTree); board ideas on the main model with source kinds (public job service, sector, regional, agency); a board dropped after 3 runs with 0 relevant jobs; up to 3 untried boards per run while relevant jobs < 10 | new session | – (reads PR 1's ledger when it lands; until then counts its own matches) |
| 3 (#1333, merged) | **Structural routes when a board refuses**: before 'browser', try what the board itself declares: RSS/Atom alternates, `robots.txt` sitemaps → job pages with schema.org JobPosting, a JSON search the page declares; kept as data per host; 'browser' boards retried after 30 days. 401/403/429, a bot check or a login wall still stop | new session | – |
| 4 | **Employer from every board job**: the posting's hiring organisation (JSON-LD `hiringOrganization`, the card's employer) becomes the job's company, and goes to `scout_candidates.harvest` with origin "Board employer" (fc's queue ranks it) | new session | – |
| 5 | **Widen or narrow by yield**: fewer than 10 relevant jobs in places → the AI's fixed-shape answer {phrases in the places' language, nearby towns, sort titles first}; above 40 → narrow by level and skills; shown in the log; the user's role list untouched (decision 1) | personas | 1 |
| 6 | **Learn across installs**: "Help the pool grow" sends source host × role family × country counts (+ phrases at k ≥ 3); the site sums them; the ranking comes back in the employer index (`boards`), the one delivery path; each run starts from it and explores a little | personas or new | 1, 2 |
| 7 | **Small fixes**: a timed search sorts its job titles in whole rounds of calls (it planned "28 of 600" and finished in 7 s). Moved out: the silent board read (in #1336's file, told 2e), the feed-slug company name (the index names that feed by its slug: index data), "fp&amp;amp;a" (kept: it may match titles a feed sends escaped), "Musterstadt" (an employer's own template posting; the place check drops it) | personas | – |

## Rules that bite (read before coding)
- CLAUDE.md "Universal first": no site names, hosts or vendor lists in code (`tools/hardcoded-page-words.mjs`); a board is data.
- "Meaning comes from AI": a source's relevance is judged by the existing title triage and scoring, never a word list.
- Never past a login wall, captcha, bot check or 401/403/429 (CLAUDE.md safety rules); visits in the user's own browser stay the path for those.
- Public skeleton, private learned layer: only counts from fixed lists leave the Mac; the learned ranking comes back as data through the index.
- Files ≤ 500 lines (`tools/file-size.mjs`); tests first; `tools/ship.sh --background`; the owner merges.

## Progress
- [x] BEFORE measured, run 1 (proof: none: measured live, in the sketch Artifact https://claude.ai/artifact/NMRWL19DJuwXqFiid66qny)
- [ ] BEFORE learning curve, presses 2-5 + SRE control (proof: the Artifact, "Matches by run")
- [x] PR 1 yield per source + harness in tools/ (proof: tests/test_source_yield.py)
- [ ] PR 2 boards for everyone, by yield
- [ ] PR 3 structural routes when a board refuses
- [ ] PR 4 employer from every board job
- [ ] PR 5 widen or narrow by yield
- [x] PR 6 learn across installs: boards ranked by relevant jobs per role family × country, the top 2 read in the first-jobs slice (owner, 18 Oct 2026) (proof: tests/test_proven_boards.py)
  - a board's history over runs is source_yield (one copy): "no job in your places 3 runs running" drops it; found_boards.json keeps only the in-run count (board_yield)
  - shared: each found board's source_yield counts with the install's families and countries (sitefacts, migration 0094); served per cell only when 3+ installs share it
- [x] PR 7 small fixes: title rounds (proof: tests/test_title_triage.py)
- [x] Rerun after the fixes (Artifact https://claude.ai/artifact/5ezTMMBhp5SV17qMVarmz2): a region's added towns keep its country, #1367 (proof: tests/test_swiss_place.py @d68840e)
- [x] PR 8 jobs shown per source, as each is read (proof: tests/test_jobs_per_source.py)
- [ ] ~~PR 9 the first 3 relevant jobs always scored in press 1~~: replaced by A (owner, 18 Oct 2026, "0 + A + B": the floor folds into A)
- [ ] 0 · a fixed replay test: each persona's search recorded once (src/search_tape.py, tools/persona-search --tape), replayed offline; time to the 1st and 10th relevant job and to the first 70+ per press 1
- [ ] 0 · six personas recorded (finance Amsterdam, music Berlin, driver Nuremberg, SRE Zurich, software Cluj, software Chisinau) and replayed twice with the same numbers
- [ ] 0 · the same three numbers counted on real installs (no personal data)
- [ ] A · score the best jobs first: a free ranking (closeness to the target roles, level, language and place), the AI scores from its top; measured on test 0
- [ ] B · one source queue by relevant jobs per second per role family × country, shared across installs, about 1 in 5 tries something new; measured on test 0
- [ ] AFTER: persona harness meets the target, SRE control no worse (proof: the Artifact, before/after)

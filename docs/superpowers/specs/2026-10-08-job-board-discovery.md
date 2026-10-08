# Job boards discovered, read and shared, for any country

Owner, 8 Oct 2026: "We should be able to discover new job boards" (shape approved: "Yes. The shape is right"). Today `src/sources/boards.py`
has three fixed readers (jobs.ch and SwissDevJobs: Swiss only; TechTree: developer jobs) and the ideas prompt says "never a job board", so an
install in Lisbon never finds net-empregos.pt, itjobs.pt or Sapo Emprego.

## 1. Decision (do not re-open)
- Universal: **no code per board**. A board is data: a name, its host, a search address with `{role}` and `{place}`, the countries and
  kinds of role it serves.
- Inside the reading rules (CLAUDE.md): public pages only; never log in, never get past a login wall or a bot check (401/403/429 or a
  check is a no). A board that refuses is offered as a visit the user starts.
- Switzerland keeps jobs.ch, SwissDevJobs and TechTree with their own readers, unchanged. Discovered boards only add.
- Through what exists: the AI ideas step proposes, the careers reader + AI page reader + recipes read, `visits` offers, `site_facts`
  shares (3 installs agree), the employer index serves. No second delivery path.

## 2. The four parts
1. **Discover** (`src/ai/board_ideas.py`): one Claude call when the search's places or roles change (kept per set, like
   `boards.board_queries`): job boards for these countries and roles, each `{name, host, search_url}` with `{role}`/`{place}`;
   validated (https, own host, the two placeholders, not LinkedIn/Indeed/Glassdoor which are portals already). Plus the boards the
   central index serves for the user's countries.
2. **Read** (`src/sources/found_boards.py`): the search page for each of the user's board searches and places, through the careers
   reader (schema.org JobPosting, links, the AI page reader within its caps, learned recipes); jobs go through the same place, role and
   scoring path as any aggregator. A board that answers 401/403/429, a bot check, or a page only scripts fill is marked `browser`.
3. **Keep** (`data/found_boards.json`, a cache): per board, jobs found per read, last read, `browser` or `dead`; a board that found no
   job three reads running is dropped from reading (kept for the visit list if it is `browser`).
4. **Share**: a board that read jobs is a site fact `{host, kind: 'board', url: search_url, body: {countries, kinds}}` (public facts
   about a site; never the user's own search words: the url is the template, not the filled search). The site serves a board fact
   when 3 installs shared it (`SITE_K`), in the employer index; installs in those countries read it at once (step 2).

Visits (`src/sources/visits.py visit_list`): a `browser` board is offered beside LinkedIn and Indeed, with the user's role and place
filled in, least recently read first.

## 3. Data ownership
- **Product data, not user data**: which boards exist and how to search them is public knowledge about sites, shared and served centrally
  (like the employer index). It never goes into the user's Notion.
- **On the Mac / runner, a cache only**: `data/found_boards.json` (proposals, outcomes); deleted, it is rebuilt by one Claude call and the
  next reads. The user's own search words never leave the machine (the shared url is the `{role}`/`{place}` template).
- Jobs found on a board are ordinary jobs: Job Matches rows as for any source.

## 4. Not in this spec (owner's decisions, asked separately)
- Adzuna / Jooble without the user's own keys (a relay on the site with the product's key: a cost decision).
- An equivalent of the jobs.ch employer lookup outside Switzerland comes for free once a board offers a company search; not built here.

## 5. Work, as commits
1. Spec + discover (`board_ideas.py`, validation, cache). The ideas step's "never a job board" stays: it is about an employer's own job
   site; boards have their own list.
2. Read + keep (`found_boards.py`, wired as an aggregator, `browser`/`dead` marks; tests on fixture pages, a JobPosting page and a
   refusing one). Gate: the Swiss parity (`tools/meanings_parity.py`): Swiss readers and their results unchanged.
3. Visits: `browser` boards in the visit list.
4. Share + serve: site fact kind `board` (engine `contribute.site_facts`, `site/src/pool.js SITE_KINDS`, `site/src/employers.js`), and the
   install merging served boards for its countries.

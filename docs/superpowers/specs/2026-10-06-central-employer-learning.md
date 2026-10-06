# Central employer learning (6 Oct 2026)

**Goal (owner):** the central employer list is the product's edge. Collect as much as installs learn about employers, fast, so the app can
rank and recommend sources better for every kind of search, not only IT.

## What changes

| # | Change | Where |
|---|---|---|
| 39 | An employer is alive while it lists open jobs of **any** kind; it leaves the index after 90 days with none. Never judged by IT words. | `src/scout.py` `health` |
| 44 | Freshness per employer, published: `fresh = {ok, fails, jobs, trend, new}` (last read OK, failed reads in a row, jobs now, up/flat/down, last day new jobs appeared) | `scout.health`, `site/src/employers.js`, `src/employer_index.py` |
| 40 | Installs share **every** feed their scout verified, not only those that gave a matching job | `src/contribute.py` |
| 41 | Shared right after every "Find new employers" and every jobs check (at most every 10 minutes per install; was once a day) | `src/contribute.py`, `src/scout.py`, `site/src/pool.js` |
| 42 | Share v2 per feed: `how` (how it was found, fixed words), `jobs` (listed), `hits` (matched in the user's places), `site` (its job-site address), `failed` (read failed) | `contribute.py`, `pool.js`, D1 migration |
| 43 | "No readable job site" results shared (company name + website host) and published, so installs skip that employer for 30 days | `contribute.py`, `pool.js`, `scout.py` |

## Data ownership

- **Product data, not user data:** job systems, addresses, company names, website hosts, counts, fixed words. Nothing about jobs a user saw,
  applied to, their CV, Notion or identity. The install id stays hashed on the site.
- **Opt-in as before:** sharing follows "Help the pool grow" (on by default for new installs).
- **Fixed words in, validated on both ends:** `how` from a fixed list, numbers capped, addresses checked as public hosts. The server never
  sends text that becomes prompt text.
- **Kept:** D1 `contributions` rows (90 days, as today) and the published index (KV/D1). The central scout's own `feed_health` table holds freshness.

## Not in this change

Using the new fields to rank sources for a user (next: prioritise employers whose `hits` are high for the same role kinds and places).

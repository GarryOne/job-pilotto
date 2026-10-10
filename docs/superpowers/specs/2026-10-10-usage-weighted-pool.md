# Usage-weighted pool growth (10 Oct 2026)

> **Decided (owner, 10 Oct 2026): ON BY DEFAULT**, with the technical reports. **Changed while building:** the app does not send a country. The site joins it from the
> install's own `contributions.countries` (already shared), only for a country with ≥ 3 installs of that host; the rest is "other". No extension change: the fill report
> already carries the page host. Step 1 = migration 0049, `site/src/hostuse.js`, `desktop/lib/host-clean.js`.

**Verdict:** a fill card can carry the install's country and the application's end host with small changes, but the data must not ride on `fill_cards`
(no install id there, so k≥3 is impossible). Add one aggregate table next to it. **Owner chose default on.**

## Privacy change, in one line
Installs that already send technical reports would also send, per application, the country tag of their own search settings and the host the application
ended on; the site serves a host only when ≥ 3 distinct installs used it.

## What exists today (Step 0)
| Thing | Where | What it carries |
|---|---|---|
| Fill card | `extension/fill-card.js` → app `desktop/lib/recipes.js` `card(board, card)` → `site/src/recipes.js` → `fill_cards` (0026) | random id, day, **board**, counts, causes, fixed words. **No install id, no region, no host.** |
| `board` | app side | a known board's name, else `h:` + 10 hex of a hash: an unknown host is unreadable by design |
| Region tag | `board_reads` (0031): `install`, `roles`, `regions`, later `countries`, `metros` (`src/contribute.py` `tags`, `src/pool_tags.py`) | AI labels the user's own search places from **fixed lists**; free text never leaves |
| End host | `applying_pool` (0048): `start_host`, flow signature `…@host#reached` | only from the owner's smoke, not from users |
| Install identity | the card batch POST body has `install` (`recipes.js` l.144) | used for the daily quota only; not stored with cards |

## What it takes
- **(a) region:** the app already computes `countries` (list `COUNTRIES`, includes `md`) and `regions` (list `REGIONS`) for `board_reads`. Reuse that cache; the site joins the install's `contributions.countries` when it reads (nothing new is sent). Country, not only region: "Moldova 80%" is a country.
- **(b) end host:** the extension knows the tab's final host when the journey ends (`extension/tab-identity.js`). It sends the **registrable host only** (`careers.acme.md`), lowercase, `[a-z0-9.-]`, ≤ 80 chars. Never a path, query, fragment, port, token, user info or address; anything else is dropped, not trimmed. The app re-checks, the site re-checks (same regex).
- **Where it lives:** new table `host_uses(install, day, host, platform, country, filled, ready, n)`, PK `(install, day, host)`. `install` is the existing install id, used **only** to count distinct installs; raw rows are never served or listed.

## Data ownership
| Data | Lives in | Why |
|---|---|---|
| Host + country counts | site D1 `host_uses` (product data, not user data) | learned from installs; same class as `board_reads` |
| The user's search places | unchanged: user's store | only the fixed-list country id leaves |
| Suggested-host list | **derived on read** from `host_uses` (≥ 3 installs) minus `applying_pool` | no second copy |
| Pool candidates (Step 3) | `applying_pool` / discovery list, written by the owner's tool | never a posting from a user |

No new user data on the Mac; nothing in Notion.

## Privacy design
- **Counts only.** A row says: this install, this day, this host, this country, n applications, how many reached "ready".
- **Fixed lists:** country from `COUNTRIES`; platform from `site/src/platform.js` (derived, not sent).
- **k ≥ 3:** a host appears in any response only when `COUNT(DISTINCT install) ≥ 3` over the window; below that it is counted in an "other hosts" total with no name. The same rule per (host, country) pair.
- **No per-install host list is ever served**, not in `/admin/*` either; the admin query is aggregate-only (a test asserts the SQL has the HAVING).
- **Retention 90 days** like `board_reads`: pruned by the same job (`pool.js` l.294 pattern).
- **Guards:** a test fails when an uploaded host contains a path, query, token, address, port or `@` (both the app/extension validator and the site's); the guard test also loops over every field of the new payload.
- **Not sent:** tests, twins and e2e installs (same rule as "How applications ended"); installs that do not send technical reports.
- **Website:** `site/public/intelligence.html` + teaser + README get an entry in the same change that ships it (count updated).

## Decision for the owner
| | Default on (with technical reports) | Opt-in switch |
|---|---|---|
| Signal | every reporting install, fast | only those who tick it; Moldova's users may be few |
| Trust | one more line on a screen users already agreed to | one more consent screen |
| **Recommendation** | **Default, because it rides on the technical-reports consent and carries only a host + country at k≥3; a visible line in "See what's sent".** | |

## Steps (after approval)
1. Migration `0049_host_uses.sql`, validators (extension/app + site), tests first; extension version bump + fingerprint; Intelligence page.
2. `/admin/applying` "Next sites to add": top 5 hosts/platforms not in the pool, ranked by country then volume, same table pattern.
3. A suggested host becomes a pool candidate (discovery list or public-feed posting). Never a user's posting.

Flow core: the extension change touches only the card/end-host report, not `FLOW_CORE`; I will still message peers before touching `extension/`.

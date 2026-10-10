# Pool failures feed the learning loop (10 Oct 2026)

> **Status: Step 0, awaiting go from job-pilotto-b8.** Owner, 10 Oct 2026: a real form filled 4 of 13 and nothing was learned from it.

**Verdict:** the nightly pool becomes a second, **labelled** source for the same fill cards users send. A form that fails in the pool shows up in the
digest as a ranked weakness with its cause, in its own section, before a user hits it. Pool rows never touch a user-facing number.

## The change in one line
The smoke runner uploads one `source = 'pool'` fill card per form reached, to the same `POST /api/controls` and the same `cleanCard` validator, with the owner's key.

## (a) What a pool card carries
Exactly a user's card (`extension/fill-card.js` `cleanCard`), nothing added except `source`:
| Field | Pool value |
|---|---|
| `id` | `pool-<day>-<8 hex of sha256(shape)>`: one card per shape per night, so a resend adds nothing (`INSERT OR IGNORE`) |
| `board` | the platform label when it is a known board name, else `h:<10 hex>` (same rule as users: `^(h:[0-9a-f]{10}\|[a-z0-9.-]{2,40})$`) |
| `v` | the extension version under test |
| `required`, `filled`, `left`, `unread`, `optional`, `optionalFilled` | counts from `fieldList` |
| `causes` | counts by `CAUSES` word, from `causeOf` |
| `kinds` | counts of the left fields' type words (`cleanCard` strips to `[a-z-]`) |
| `ai`, `kit`, `seconds` | `'none'`, `false`, 0 (the pool has no kit; no AI timing) |
| `source` | `'pool'` (new, top level; `cleanCard` does not carry it, `controls()` reads it) |
Never: an answer, a field label, a question's wording, a posting address, a host. The pool's `host` is **not** sent (users' `host` feeds `host_uses`; pool hosts would
inflate the usage weighting that picks pool sites: a pool card never calls `recordUse`).

## (b) Reasons → causes
`parseLive().fieldList` gives `{outcome, type, label, required, reason}`. The runner builds a trace of `{label, type, required, outcome, reason}` and calls the
**same** `fillCard()` from `extension/fill-card.js` (imported, not copied), so `causeOf` is the one mapping. Caveats:
- `causeOf` needs `sent`/`ai` only for the `NO_ANSWER` reason; the pool has no such context, so those rows come out `no_data` (see (e): excluded from pool weaknesses).
- The app's `field ...` log line cuts `reason` at 80 characters (`smoke.mjs`/`apply-live.mjs`); if a `menuCause` pattern needs more, Step 1 raises the cut (asks b8: file is theirs).
- `label` is used only in memory to run `causeOf`/`fillCard` (they drop it); it is never put on the card. A test asserts this.

## (c) Where it is stored
**A `source` column on `fill_cards`**, `TEXT NOT NULL DEFAULT 'user'` (migration `0052_fill_cards_source.sql`, number re-checked when landing). Why not a
separate table: the card is the same shape and validator, the digest already reads `fill_cards`, and one table keeps "one delivery path". Cost: every reader must
filter. Mitigation: `digest()` takes `cards` once through one `SELECT ... WHERE day >= ? AND source = 'user'` for everything existing, and a second `source = 'pool'`
query feeds only the new section; a test fails if a pool row changes `thisWeek`, `boards`, `versions`, `daily`, `recent`, the filled share or `host_uses`.

**Authentication:** `/api/controls` has no per-card auth (an install id + a daily limit). A card with `source: 'pool'` is accepted only when `isOwner(request, env)`
(`site/src/stats.js`, the owner's Bearer key, Keychain `job-pilotto.site.api_key`, already what `applying-report.mjs` uses); from any other caller the card is
**dropped and flagged** (`flag(env, 'pool-source', ...)`), never stored as 'user'. No second endpoint, no new secret.

## (d) How the digest treats it
- New section `pool` in `digest()` (and the markdown): weaknesses by `board x cause`, each with `seenByUsers` (same board+cause this week from user cards: forms, lost)
  and `seenInPool` (nights, forms, lost). Id `pool:<cause>:<board>`, area from the same `AREA` map.
- **A pool-only weakness** (nobody has hit it yet) is listed first as "candidate for a recipe/meaning before users hit it".
- **Pool rows never change** user-facing numbers (`summarize` over user cards only), the per-board `dropped` flag, the per-release table, nor any learning floor
  (k>=3 installs, DROP_MIN_FORMS): pool cards are not installs.
- `/admin/applying` "Needs a fix" rows (step 2, `site/src/applying.js` is b8's): show the top cause per shape from the same pool section; I ask before editing it.

## (e) Risks and how each is closed
| Risk | Closure |
|---|---|
| Double counting (a pool card and a user's on one form) | separate `source`; sections never summed; pool id is per shape per night |
| A moody site's one bad night | a pool weakness needs the **same board+cause on >= 2 distinct nights** (`nights` in the section; one night is listed as "seen once", not ranked) |
| The fake applicant's missing data counted as a user gap | pool weaknesses **exclude** `no_data`, `ai_declined`, `ai_unsure`, `ai_off`, `ai_error`, `proposed` (data/AI causes, the applicant's gap); they stay in the card's counts and a "applicant gaps" count, never a weakness. Only mechanism causes rank: `not_taken`, `menu_*`, `real_click`, `no_option`, `unread`, `other` |
| Pool run against an old build on purpose (`REAL_EXTENSION_DIR`) | same `skipReason()` as the report: no upload (control runs, CI, `JP_NO_REPORT`) |
| A pool card's `board` identifying a posting | known label or `h:` hash only; test refuses anything else |
| Cost of ranking by `impact = forms x lost` with one pool form per night | pool rank uses nights x lost; a user weakness of the same id is shown beside it |

## Data ownership
- **Site D1 `fill_cards`** (product data, aggregate, anonymous): pool cards live here with `source = 'pool'`, kept like user cards. Nothing about a user; the pool has no user.
- **Notion / the Mac:** nothing. The runner reads `fieldList` from its own run log and sends; no local copy.
- **Public skeleton, private learned layer:** the card format, `cleanCard` and `causeOf` stay public; what is learned (the ranking, recipes, meanings) stays on the site
  and is served through the existing packs. No second delivery path.

## Steps
1. Runner uploads pool cards (`desktop/e2e/smoke.mjs`, a small `lib/pool-card.mjs`); site accepts `source` for the owner only; migration; tests first.
2. Digest section + `/admin/applying` "Needs a fix" top cause (with b8).

## Tests (first)
- a pool card has only the fixed fields; any label, address, host or answer in it fails (`desktop/e2e/test/pool-card.test.mjs`);
- `controls()` stores `source: 'pool'` for the owner and drops it (with a flag) for an ordinary install, never storing it as 'user' (`site/test`);
- the digest keeps sources apart (a pool row changes none of the user numbers), needs >= 2 nights, excludes the applicant-gap causes.

---
name: ui-look-and-feel
description: How Job Pilotto's desktop app looks and feels, with reference screenshots of every screen. Read it before building or changing any page, section, card, list, dialog or loading state in desktop/renderer, and check your result against it (render it in demo mode) before saying it's done.
---

# Job Pilotto: look and feel

The owner designs by mockup and judges by screenshot. A screen is done when it looks like the rest of the app
*and* like the mockup, not when the code works. Before you say a UI change is finished, render it (below) and
look at it.

## 1. Look first
- Reference screenshots of today's screens: `desktop/docs/ui/*.jpg` (fictional demo data). Open the one closest
  to what you build and match it: spacing, density, card style, where actions sit.
- Refresh them after a screen changes: `cd desktop && npm run ui-shots` (demo mode, never real data), and commit
  the new images with the change.
- Tokens and components: `desktop/renderer/tokens.css`, `components.js`/`components.css`, `npm run gallery`.
  Only `var(--…)` values: `desktop/test/design.test.js` fails on a raw colour, radius, font size or font family.

| Screen | File | Shows |
|---|---|---|
| Focus | `focus.jpg` | Up next rows, Insight, funnel; side column (progress, reminders, your focus); sessions dock |
| Focus, loading | `focus-loading.jpg` | Skeleton cards in the page's shape, "Syncing…" by Refresh |
| Jobs | `jobs.jpg` | Stat tiles, toolbar, job rows (fit ring, tags, status pill, main action, ⋯) |
| Session | `session.jpg` | List + detail: job header, "Your next step" card (steps, one primary, state on the right), Before you submit + Form audit cards, folded session log |
| Actions | `actions.jpg` | Running banner, task cards by category with a Run button, Recent runs table |
| Interviews | `interviews.jpg` | Recorder, drafts, saved library table |
| Settings | `settings.jpg` | Setting rows: title, one-line explanation, control |
| Strategy | `strategy.jpg` | Long-form editing |

## 2. Page anatomy
- **Header**: `h1` + one short subtitle (what the page is for, ≤ 10 words). Right side: status text (muted,
  "Updated just now", "Telegram connected" with a dot) and at most one or two buttons (Refresh, a link to settings).
- **A live banner** when something runs for this page (a search, a sync): spinner, bold "X is running", muted
  "Started 19:48 · what it's doing", one secondary button (View activity). Blue-tinted card, full width.
- **Two columns** when the page has a main list plus context: main (`minmax(0, 1fr)`) and a side column (~320 px)
  of small cards (progress, settings, a one-sentence summary). One column below 1180 px.
- **Sections** get an `h2` ("Up next", "Run a task", "Recent runs") with an optional pill count ("3 actions") or
  a link on the right ("View all activity"). No explanatory paragraphs; one muted line at most.

## 3. Cards and rows
- **White card** (`.card`): `--surface`, 1 px `--line` border, `--r-md` radius, soft shadow at most. Cards sit on
  the grey page background with `--sp-4` gaps.
- **Action/item row** (Focus Up next, dock, task cards): round or rounded-square **icon tile** on the left (tinted
  `--surface-2`/`--info-soft`, line icon from `icons.js`), then **headline** (bold, one line, `…` if long) with its
  **badge** beside it (`pill(text, tone, {dot})`), then a **meta line** (muted, small, parts joined with ` · `), then
  **one primary button** on the right, a secondary (Done, Review) if needed, and **⋯** (`moreButton`) for the rest.
- **Tone = meaning**, the same everywhere: `bad` (red) needs you now / failed, `warn` (amber) soon / waiting for
  you, `info` (blue) next step / running, `good` (green) done / completed, `neutral` later / ended. Rows needing
  attention get a 4 px left border in that tone.
- **Category label** above a card title when cards are grouped: small caps, muted, letter-spaced (DISCOVERY,
  COMMUNICATION, INSIGHTS).
- **Compact by default**: rows ~56–64 px high, padding `--sp-2 --sp-3`, gaps `--sp-2`. The owner asked for
  "more compact" once: don't drift back to airy rows.
- **Tables for history** (Recent runs, libraries): icon tile, bold name, status pill, time, a muted result, `›`.
- **Numbers big, labels small**: progress "0 / 30", funnel counts; a bar under it with the %.
- **Emoji**: fine inside text the owner reads (Telegram style), but UI chrome uses line icons.

## 4. States
- **Loading**: skeleton cards in the page's final shape (`.skeleton` bars, shimmer), plus a small spinner and
  "Syncing …" next to Refresh. Never an empty page, and never an empty-state message while data is still loading.
- **Refreshing**: keep what's shown; the status text says "Refreshing…".
- **Empty**: say why and what to do, specific to the filter ("No saved jobs yet. On any job, ⋯ → Save keeps it
  here."), never a generic "No data".
- **Errors**: say what failed and what to do, where the content would be; never a blank page.
- **Background tasks** (search, Gmail, insight…): Recent activity opens and shows the run, then its result under
  its row. Instant look-ups answer on the page. Nothing is shown *behind* an open panel.

## 5. Words
- Short and concrete: "Reply to AG Talent recruiter", "Apply to your next role", "Needs your input".
- Buttons are verbs: Run, Respond, Review, Open email, Browse jobs, Done.
- Times: "Today 19:10", "Mon 19:10", "Updated just now"; money "€70k–90k".

## 6. Check before you say it's done
Render the screen with the demo data (fictional, no real profile), then open the image:
```
cd desktop && D=$(mktemp -d) && for f in demo/*; do [ "$(basename $f)" != jobs.json ] && cp "$f" "$D/"; done
JOB_PILOTTO_DEMO=1 JOB_PILOTTO_USER_DATA=$D JOB_PILOTTO_SMOKE=/tmp/shot.png \
  JOB_PILOTTO_SMOKE_JS="document.querySelector('.nav[data-view=actions]').click(); new Promise(r => setTimeout(r, 1000))" \
  ./node_modules/.bin/electron .
```
- Demo data a new screen needs goes in `desktop/demo/` (fictional names), served in `JOB_PILOTTO_DEMO` mode.
- Compare with the mockup side by side: layout, density, what's primary. Fix what differs, then say done.
- Add the screen to `SCREENS` in `desktop/scripts/ui-shots.mjs`, run `npm run ui-shots`, commit the image.

## 7. Code pitfalls seen here
- `let`/`const` used by start-up code (a view opened at launch, the job list) must be declared at the top of
  `app.js`: a later declaration throws "Cannot access before initialization" and blanks the whole window
  (tests in `desktop/test/app.test.js` guard the known ones).
- New grid children of `.app` need their row/column (`grid-column: 2`), or they push the activity bar aside.
- A new IPC call needs the handler in `main.js` *and* the preload entry; a window newer than the running app
  shows "Job Pilotto was updated: restart".

# Desktop UI: one design system

Read before building or changing a screen in `desktop/renderer`. Also read the skill `ui-look-and-feel`. Linked from CLAUDE.md.
Why each rule exists: [why.md](why.md#desktop-ui).

## Design system (owner, 17 Oct 2026): read first
The approved page: https://claude.ai/artifact/15HyjPkVFpyrVW4FSEMurR (Do/Don't from real screens, every kind's read and edit view, contrast).
Living copy: `npm run gallery` (sections "Chips" and "Value → control", drawn by the screens' own code). How to apply it: skill **ui-look-and-feel** §0.
- **The value's kind picks the control.** Short text → a field sized to it; long text → a box that grows; yes/no → two buttons; one of ≤ 3 short → segmented;
  one of many → a menu; several → chips with × + Add; date, amount, salary, duration, link, per country, language + level, range → `answerControl(formatFor(...))`
  (`renderer/question-control.js`). Never prose in a text box: a value is split into its parts, the rest is a note.
- **Read views are rows and chips, never prose bullets.** Label → value rows (`.summary-rows`), several values as chips, a missing one as `pill('Not set', 'warn')` with its action.
- **A note for the AI** (a date it was confirmed, "use the closest option") is a muted line under its value, never inside it; edit: a folded "Note for the AI".
- **Chips are values, pills are status, tags are labels.** `chip(text, {detail, tone, onRemove})` (components.js) shows a value as a person writes it: no quotes,
  /regex/, codes or stored comma lists (show their meaning: a group "Whole word only"); duplicates folded. No new chip class (14 existed; they move to chip()).
- **Nothing cut.** A saved value always fits its box; a row title is one line with … and the full text on hover; a question two lines. Prose ≤ 72 characters wide.
- **Spacing from the scale:** label → field 4, field → field 12, card padding 16 (a settings card 24), card → card 16, section → section 32. Two columns only for short fields.
- **Card or section:** a card is one topic you read or act on; never a card in a card (inside: rows, dividers, a table). One primary button per card.
- **Icons alone only on secondary buttons** (owner, 18 Oct 2026: "let's leave icons only for secondary buttons"): a primary button, and a row's main action, always shows its words (an icon beside them is fine);
  an icon-only button is a secondary one with a tooltip and an aria-label. Fails: `desktop/test/design-buttons.test.js` (every renderer file) and the UI check's `icon-only-primary` (every view).
- **Contrast AA in both themes:** text 4.5:1, a field's edge 3:1. A filled accent under white text uses `--signal-solid`.
- **What fails a change:** `desktop/test/contrast.test.js` (token pairs, both themes), `text-fields.test.js` (a new free text box: use the typed control, or
  raise the file's count in `text-fields-allowed.json` with the reason), `chip.test.js` (raw chip text, a new chip class), `design.test.js` (raw values);
  `npm run shot` prints every saved value cut by its box; `tools/pr-body.sh` refuses a desktop-window PR without the 6 **Design checks** ticked.

## Cards: read → Edit → editor; one save bar (owner, 18 Oct 2026, UI redesign)
Every Profile and Strategy card works one way ("so nice, so clean"). Parts: `renderer/card-shell.js` + `card-shell.css`, `components.js` `cardEdit`, `renderer/save-bar.js`;
living copy: `npm run gallery` → "Card shell"; API for other sessions: `~/job-pilotto-ui-mockups-2026-10-18/SHARED-PARTS.md`.
- **Header:** icon, title, one-line description (`.panel-lead`), then at the right a quiet **✎ Edit** (`cardEdit`: neutral outline, pencil + word, always visible) and the chevron. Same place on every card.
- **Read view by default** (`.card-read`): `readRows` (label → value; empty = `pill('Not set', 'warn')`; a note for the AI is a muted line under its value) and `chipLine`
  for several values ("English · B2", "Romanian · Native"). Never the editor's controls just to read.
- **Edit** (`setEditing(card, true)`): Edit hides, the card stays open (a folded one opens), `.card-editor` shows `editRows` (one aligned label column, full-width controls).
  Drafts survive switching tabs and folding; leaving the editor never drops them. An editor with no change closes with the shared quiet **Done** (`doneButton(card, count)`,
  shown only at 0 changes); with changes, Save all / Discard all close it. Never a card's own Close or Cancel. A Profile page bar is `pages/profile-save-bar.js` `profileBar()`.
- **No Save, Cancel or Discard on a card.** Each card registers a source with the page's one `pageSaveBar`: "N unsaved changes in <tabs>" · **Discard all** (asks when drafts sit on
  more than one tab) · **Save all changes**. Tabs with drafts get a dot. A failed check saves nothing and names tab + field; a part-way failure keeps the failed drafts
  and names them, never a blanket "Saved". Leaving the page (`guardLeave(view, bar.leave)`) or closing the window (`lib/unsaved-guard.js`) asks first. The bar sticks above Application sessions.
- **Not drafts:** actions with their own button keep their behaviour (read the CV again, an AI review, Generate, Review questions).
- **Orange = the one current primary action.** Filled orange (`button.primary`) only for Save while there are drafts, or the screen's single next step (Review questions, Generate).
  Edit, Add, "View source in Notion", "Fill from my CV" are quiet (secondary, ghost or in the ⋯ menu); one "View source in Notion" per page, in a secondary menu.
- **What fails a change:** `desktop/test/card-system.test.js` (a card's own Save/Cancel/Discard in code or in the Profile/Strategy markup; a filled Edit), `card-edit.test.js`,
  `card-shell.test.js`, `save-bar.test.js`, `unsaved-guard.test.js`. Cards not moved yet are listed in `card-system.test.js` KNOWN_LEFT / MARKUP_LEFT: the lists may only shrink.

## Page blocks: review list, empty state, tiles, reference row, counts, page header (18 Oct 2026, UI redesign) [proposed]
One shared version of each, never a page's own (`renderer/page-parts.js` + `page-parts.css`, `renderer/shared-counts.js`; living copy: `npm run gallery` → "Page blocks").
- **Review list** `reviewList(items, {doneLabel, empty})`: each item = title, why it is here, where it came from, a status chip, its actions (at most one
  primary, the next step; Confirm/Dismiss/Review). Pending first; done ones folded as "Reviewed · N". CV gaps, Needs review, CV check fixes.
- **Empty state** `emptyState({icon, chip: 'Not created', title, text, actions: [primary, quiet], note})`: a neutral chip, an icon, one line, two actions.
- **Summary tiles** `summaryTiles([{key, icon, tone, label, value, note, title}])`: icon, label, big value; empty = "Not set"; 4 across, 2×2 when narrow.
- **Reference row** `referenceRow({text, from: 'From Your details', link: 'Edit in Your details', open})`: a fact kept on another page, one quiet link there.
- **One count, every place** `defineCount(name, compute)` + `paintCount(name)`: the banner (`data-count-of` + `data-count-one`/`-many` for words), the filter
  chip and the tab badge (`data-count-of`) are painted from the same function, so they never disagree; 0 hides them unless `data-count-zero="show"`.
- **Page header** (`header.view-head`): `h1` + one muted lead line, then `.head-actions`: the sync status (`.synced`), quiet buttons, the ⋯ menu (`moreButton`,
  "View source in Notion" lives there), **at most one** `button.primary`; the page's `.tabs` come right under it. Profile uses the same parts in `.settings-page-head.has-action`.
- **What fails a change:** `desktop/test/page-parts.test.js` (each block's shape; a page header with a second primary button; Strategy's tabs not right under its header).

## Structure
- **The window is one module per page** (`desktop/renderer/pages/`); `renderer/app.js` only runs each page's `init()` in order. Helpers every page
  uses are in `pages/core.js`; state more than one page *reassigns* lives on `shared` (`pages/shared.js`), since an imported binding is read-only.
  Logic testable without a window goes in its own small module (`renderer/session-message.js`, `session-state.js`) with a test in `desktop/test/`.
- `electron .` works in any worktree: `desktop/start.js` builds `shared/` when it's missing; a test run (`JOB_PILOTTO_SMOKE…`) that can't start
  prints why and quits.

## Checking a UI change (the tier decides how much)
- **Tier 0** (copy, CSS): no screenshot; the tests.
- **Tier 1** (a feature, a screen or state): one targeted shot of the whole surrounding view at real size, compared with its siblings:
  `npm run shot -- <page> --js "<force the state>" --select '#id'` (~5 s); `--eval "…" --no-picture` reads `window.__jp` as JSON; `--reload` tests after ⌘R.
- **The full reference set** (`npm run ui-shots`): only for big changes, about daily, or when the owner asks.
- **PR screens are one table, always** (owner, 17 Oct 2026, #1290: two stacked full-window shots, no caption, "it's not clear"): every image sits in a row of
  `| What changed | Before | After |`: the caption says what changed and where to look (a few words), then the before image, then the after image. A new screen: `—` before and the reason in the caption.
  Shoot **the changed card, not the window**: `npm run shot -- <page> --select '<card>' --mark '<the changed control>'` with the SAME options on the before build and the after build
  (`--mark` draws a red frame, `--mark` can repeat); a full window only for a layout change (sidebar, spacing between cards). Enforced twice: `tools/pr-body.sh` at ship time and
  `tools/pr-body-check.py` in the required CI job (`tools/pr-screens.py`; tests `tests/test_pr_body.py`, `desktop/test/shot-mark.test.js`).
- **PR images: at most 5 before/after pairs, usually 1-2** (owner, 17 Oct 2026; `tools/pr-body.sh` refuses more than 10 images).
- **PR images are published with `node tools/pr-assets.mjs pr-assets-<branch> <png>...` (a git tag + raw URL), never a GitHub release**: a normal release becomes "Latest" and the Download link points at it (17 Oct 2026; `tests/test_release_guard.py`, hourly `release-guard.yml`).
- A screenshot tool that fails for tooling reasons: drop it once, say so; don't sink time into it.
- **Screenshots show no first-launch overlay** (owner, 17 Oct 2026: the menu tour covered the sidebar in PR shots). Every capture tool runs with `JOB_PILOTTO_SMOKE`, so the page loads `?capture=1` (`lib/e2e-hidden.js` `captureQuery`); a new one-time overlay (tour, hint, what's new) checks `captureRun` (`renderer/menu-tour.js`) like the tour does.

## Reuse, never one-off
- **A new feature looks like the old ones.** Whatever a task, run or message shows, find the nearest existing one first (`pages/activity.js`
  render*Card, `components.js`) and reuse its card; never show engine or Telegram text in a `<pre>`. A new task kind needs, in the same change:
  1. a parser for its message + a render*Card on the insight-card shape, with a test; a line in `desktop/test/fixtures/engine_messages.py` (made
     by the engine's own writer) and a case in `engine-message-contract.test.js`;
  2. its kind in `CARD_KINDS` (`renderer/run-cards.js`);
  3. a look at the rendered result next to a sibling task's.
- Values live in `desktop/renderer/tokens.css` only (colours, radii `--r-*`, type scale `--fs-*`, fonts, spacing `--sp-*`, shadows).
  `desktop/test/design.test.js` fails on a raw value anywhere else. New colour or size: add a token and say why.
- Building blocks from `components.js` + `components.css`: `pill(text, tone)`, `tag()`, `tile()`, `moreButton(items)`, button classes (`primary`,
  `secondary`, `ghost`, `link`, `danger`, `with-icon`). Something new goes there (modifiers `is-…`, tones `tone-…`) and into `gallery.js`.
  `npm run gallery` shows every token and component. The website (`site/`) has its own styles.
- **UI from an owner mockup:** confirm layout + behaviour in one message before code. A card has many states; a mockup shows one: keep every state.

## Every new screen and action goes in the ⌘K palette
`paletteCommands()` in `desktop/renderer/pages/nav.js`. A new page is a `.nav` button (listed automatically). A new Actions card needs
`data-command` or `data-palette` on its Run button (`test/palette-covers-actions.test.js`). Any other new top-level button is added with
`button(view, id, keywords)`. A long or paid action opens its card and focuses its input instead of running. Settings needs nothing (listed from
the page; checked by the settings suite's ⌘K step). A new long task on this Mac is a tracked task (`pipeline.work` / `pipeline.task`).
- **❓ is data, never shown** (owner, 16 Oct 2026): a value starting with ❓ means not set; screens say "Not set" and use the words after it as the hint (`renderer/answers-model.js` valueOf / shown). The Profile tabs' render test fails on a ❓ or a textarea on screen (`desktop/test/profile-tabs-render.test.js`).

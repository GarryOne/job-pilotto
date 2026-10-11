# Desktop UI: one design system

Read before building or changing a screen in `desktop/renderer`. Also read the skill `ui-look-and-feel`. Linked from CLAUDE.md.
Why each rule exists: [why.md](why.md#desktop-ui).

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
- A screenshot tool that fails for tooling reasons: drop it once, say so; don't sink time into it.

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

# Applying flows: the scenario matrix

> **Rule:** a change to any flow file runs the **whole** matrix, `cd desktop && npm run flows` (~4 min), not just its own row.
> The push is blocked until it passes on exactly that code (`tools/flows-gate.mjs`), or the commit says `Flows-unverified: <why>`.
> Why: a fix for one flow (account creation) must never quietly break another (the application form). Owner, 8 Oct 2026.

**Flow files** (the list is `FLOW_FILES` in `desktop/e2e/flows.mjs`): `extension/background.js`, `tab-pages.js`, `same-tab.js`, `review.js`,
`flow.js`; `desktop/lib/review.js`, `terminals.js`, `apply.js`, `session-handlers.js`, `form-tab.js`.

## The one decision every flow follows

`extension/tab-pages.js` `pageRole()` says what a page is. Everything else reads that word; nothing classifies a page again.

| Page | Means | Filled by the extension | Feeds learning / "submitted" | Session shows |
|---|---|---|---|---|
| `form` | the application (incl. account + application on one page: a file upload or text box beside a password) | ✅ (passwords from the Keychain) | ✅ (password boxes never) | Form completion, "Applying" |
| `account` | sign-in / sign-up only | ❌ (left to the person or Claude) | ❌ never | "Creating account", account step |
| `no-form` | a posting or a step before the form | presses Apply once | ❌ | can't reach form → Apply with Claude |

## The matrix

| Scenario | What happens | Code | Guard |
|---|---|---|---|
| Direct application form (Greenhouse, Workday, Lever, multi-step) | filled from the kit, Submit untouched | `flow.js`, `background.js` consider/fill | e2e: Greenhouse-like, Workday-shaped, Lever-like, multi-step |
| Posting → Apply link or form into a new tab → same tab, posted data kept | the link/form is pointed at this tab before the click | `background.js` pressApply | e2e: Apply opens a new tab · `extension-same-tab.test.js` |
| Apply opens its form from the page's script: followed, posting closed | the new tab is the application; the posting closes only if it is the pressed tab, still on that page | `same-tab.js`, `background.js` closePosting | e2e: side by side · `extension-same-tab.test.js` |
| Two applications side by side: one tab and its own kit each | a tab carries its session (`session:<tab>`); a session follows its newest tab; older tabs go quiet | `background.js` review relay/followOpener, `desktop/lib/review.js` pick | e2e: side by side · `review.test.js` |
| Sign-up page before the form: account step kept apart | account page: not filled, nothing learned, "Create account" is not a submit; session at the account step | `tab-pages.js` isAccountPage, `background.js` guards, `lib/review.js` | e2e: sign-up page · `extension-tab-pages.test.js`, `review.test.js` |
| Account and application on one page: it is the form | file upload / text box + password → `form`; passwords stay account fields | `tab-pages.js` pageRole, `review.js` byYou | e2e: one page · `extension-tab-pages.test.js` |
| Form tab closed → the app sees it → Reopen fills it again | "The form tab was closed", Reopen opens it with `#jobpilotto-fill` for the same session | `session-handlers.js` sessionReopen, `renderer/session-state.js` tabClosed | e2e: tab is closed · `form-tab-closed.test.js`, `session-state.test.js` |
| The person submits → Applied, session leaves the list | the page after Submit is read; Applied in Notion | `background.js` watchSubmission | e2e: person submits a form |
| Claude takes over an account page; the unfilled tab closes | stuck `account` → Claude starts; the form tab closes if nothing was filled there | `apply.js` accountTakeOver/formTabsAtHandOver, `main.js` stuck handler | `apply-form-session.test.js` |
| Start-up "Checking…", then "Chrome isn't reporting" | no stale state while unknown; Open Chrome when the extension is silent | `renderer/session-state.js` checkingTabs/chromeSilent | `session-state.test.js` |
| Never submits, never contacts another host | across every step above | the whole suite | e2e: through all of it |

## Changing a flow

1. Find its row above. If the scenario is new, add a row here **and** in `desktop/e2e/flows.mjs` `MATRIX`, with an e2e step or unit test that fails before your change.
2. Change the code; keep the decision in `pageRole()` (no second classifier).
3. `cd desktop && npm run flows`. All rows must pass, not just yours.
4. Logs to read first: `logs/app.log` areas `review` (which tab is which session's, stages, tab gone), `extension` (page roles, presses, account skips).

<details><summary>Self-checks</summary>

`desktop/test/flows-matrix.test.js` fails when a row's step is renamed, a unit file is missing, a flow file is gone, or this page misses a scenario.
</details>

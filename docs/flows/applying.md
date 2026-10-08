# Applying flows: the scenario matrix

> **Rule:** a change to any flow file runs the **whole** matrix, `cd desktop && npm run flows` (~4 min), not just its own row.
> The push is blocked until it passes on exactly that code (`tools/flows-gate.mjs`), or the commit says `Flows-unverified: <why>`.
> Why: a fix for one flow (account creation) must never quietly break another (the application form). Owner, 8 Oct 2026.

**Flow files** (the list is `FLOW_FILES` in `desktop/e2e/flows.mjs`), one concern each:

| File | Owns |
|---|---|
| `extension/tab-pages.js` | the one page rule (`pageRole`, `isAccountPage`), pure |
| `extension/tabs.js` + `same-tab.js` | which tabs are one application: inherit, follow, close the posting |
| `extension/account.js` | each tab's page type, the account guards every learner asks |
| `extension/fill-flow.js` | the fill flow: the page's kind, posting → Apply → form → fill, "can't reach" reports |
| `extension/background.js` | the worker: tabs and pages the app opened, fills, submit watching, messages |
| `extension/review.js` | the page's panel: progress, what you typed, the submit press |
| `extension/log.js`, `tab-memory.js`, `flow.js` | shared: the decision log, the tabs' memory, the app/Worker calls |
| `desktop/lib/apply-handlers.js`, `browser-handlers.js`, `kit-handlers.js` | the app's IPC for the application flow: Apply and Apply with Claude, the form page's review state, showing a form tab, the kit a job needs (moved out of main.js) |
| `desktop/lib/session-flow.js` | the app's decisions: stuck → hand-over, the stage from each report, the hand-over's tab |
| `desktop/lib/review.js` | which session a report belongs to (carried session, newest tab) |
| `desktop/lib/terminals.js`, `apply.js`, `session-handlers.js`, `form-tab.js` | sessions, opening forms, reopen, Chrome's tabs |

## The one decision every flow follows

**What kind of page is this?** The AI decides (`desktop/lib/page-kind.js`), from a sketch of the page in its own language (headings, each
control's type and label, the buttons): `form`, `account-form`, `account`, `posting` or `other`. No site words, no lists of labels or controls:
it works on thousands of sites in any language (owner, 8 Oct 2026). The answer is kept per site and page shape (asked once; `page-kinds.json`
on the Mac), logged as `page kind: <kind>` with who decided. Without AI, or when it is unsure, `extension/tab-pages.js` `pageRole()` decides
from structure alone. Everything else reads the resulting role; nothing classifies a page again.

**Self-correction:** a kept kind the page contradicts is dropped and asked again next visit, never repeated. A "form" with no fields to fill,
or a "posting" with no Apply but an application form's fields, is decided by structure this visit (`page kind corrected` / `page kind
forgotten` in the log).

| Page | Means | Filled by the extension | Feeds learning / "submitted" | Session shows |
|---|---|---|---|---|
| `form` | the application (incl. account + application on one page: a file upload or text box beside a password) | ✅ (passwords from the Keychain) | ✅ (password boxes never) | Form completion, "Applying" |
| `account` | sign-in / sign-up only | ❌ (left to the person or Claude) | ❌ never | "Creating account", account step |
| `no-form` | a posting or a step before the form | presses Apply once | ❌ | can't reach form → Apply with Claude |

## The matrix

| Scenario | What happens | Code | Guard |
|---|---|---|---|
| What kind of page: the AI decides once per site and page shape, the structure rule only without AI | the extension sketches the page, the app asks once and keeps the answer | `page-kind.js` (+ forgetPageKind), `background.js` askKind/forgetKind, `server.js` /extension/page-kind | e2e: one page, wrong kind · `page-kind.test.js`, `extension-tab-pages.test.js` |
| Direct application form (Greenhouse, Workday, Lever, multi-step) | filled from the kit, Submit untouched | `flow.js`, `background.js` consider/fill | e2e: Greenhouse-like, Workday-shaped, Lever-like, multi-step |
| Posting → Apply link or form into a new tab → same tab, posted data kept | the link/form is pointed at this tab before the click | `background.js` pressApply | e2e: Apply opens a new tab · `extension-same-tab.test.js` |
| Apply opens its form from the page's script: followed, posting closed | the new tab is the application; the posting closes only if it is the pressed tab, still on that page | `same-tab.js`, `tabs.js` closePosting | e2e: side by side · `extension-same-tab.test.js` |
| Two applications side by side: one tab and its own kit each | a tab carries its session (`session:<tab>`); a session follows its newest tab; older tabs go quiet | `tabs.js` followOpener, `background.js` review relay, `desktop/lib/review.js` pick | e2e: side by side · `review.test.js` |
| Sign-up page before the form: account step kept apart | account page: not filled, nothing learned, "Create account" is not a submit; session at the account step | `tab-pages.js` isAccountPage, `account.js` guards, `lib/session-flow.js` reported, `lib/review.js` | e2e: sign-up page · `extension-tab-pages.test.js`, `review.test.js` |
| Account and application on one page: it is the form | file upload / text box + password → `form`; passwords stay account fields | `tab-pages.js` pageRole, `review.js` byYou | e2e: one page · `extension-tab-pages.test.js` |
| Form tab closed → the app sees it → Reopen fills it again | "The form tab was closed", Reopen opens it with `#jobpilotto-fill` for the same session | `session-handlers.js` sessionReopen, `renderer/session-state.js` tabClosed | e2e: tab is closed · `form-tab-closed.test.js`, `session-state.test.js` |
| The person submits → Applied, session leaves the list | the page after Submit is read; Applied in Notion | `background.js` watchSubmission | e2e: person submits a form |
| Claude takes over an account page; the unfilled tab closes | stuck `account` → Claude starts; the form tab closes if nothing was filled there | `lib/session-flow.js` stuck/handOver, `apply.js` accountTakeOver/formTabsAtHandOver | `apply-form-session.test.js`, `session-flow.test.js` |
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

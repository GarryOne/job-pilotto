# Applying flows: the scenario matrix

> **Rule (owner, 9 Oct 2026):** every row's e2e step runs with all the other e2e on CI (`apply`, `applycv`: the schedule and the beta gate). There is no push gate any more
> (8–9 Oct it blocked pushes touching `FLOW_CORE`: one recorded catch in 186 commits, which CI's `applycv` also runs). `cd desktop && npm run flows` (~5 min) runs the whole
> matrix on demand, e.g. after a big change to the decision core. Any other flow file: its area's suites plus the best-fit method (AGENTS.md "Which test for which question").
> Why: a fix for one flow (account creation) must never quietly break another (the application form). Owner, 8 Oct 2026.

**Flow files** (the list is `FLOW_FILES` in `desktop/e2e/flows.mjs`), one concern each:

| File | Owns |
|---|---|
| `extension/tab-pages.js` | the one page rule (`pageRole`, `isAccountPage`), pure |
| `extension/tabs.js` + `same-tab.js` | which tabs are one application: inherit, follow, close the posting |
| `extension/account.js` | each tab's page type, the account guards every learner asks |
| `extension/account-step.js`, `account-fill.js` | on a sign-in/sign-up page: the AI's step decides register / fill / press (once per tab per action); the app's `mode` says whether this email has an account here |
| `extension/fill-flow.js` | the fill flow: the page's kind, posting → Apply → form → fill, "can't reach" reports |
| `extension/background.js` | the worker: tabs and pages the app opened, fills, the page's messages (dispatcher) |
| `extension/messages-learning.js`, `messages-panel.js`, `messages-app.js` | the page's messages by group: what it learned, the panel's, the site password and the review relay |
| `extension/submit-watch.js`, `tab-report.js` | did the person submit; telling the app which tabs are open |
| `extension/review.js` | the page's panel: progress, what you typed, the submit press |
| `extension/log.js`, `tab-memory.js`, `flow.js` | shared: the decision log, the tabs' memory, the app/Worker calls |
| `desktop/lib/apply-handlers.js`, `browser-handlers.js`, `kit-handlers.js`, `ext-server-handlers.js` | the app's IPC for the application flow: Apply and Apply with Claude, the form page's review state, showing a form tab, the kit a job needs, and what the local server asks of the app when the extension calls (moved out of main.js) |
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
| `no-form` | a posting or a step before the form | presses Apply once | ❌ | can't reach form → Apply with Claude (Claude engines only; with OpenAI/Codex the step is left to the person) |

## The matrix

| Scenario | What happens | Code | Guard |
|---|---|---|---|
| What kind of page: the AI decides once per site and page shape, the structure rule only without AI | the extension sketches the page, the app asks once and keeps the answer | `page-kind.js` (+ forgetPageKind), `background.js` askKind/forgetKind, `server.js` /extension/page-kind | e2e: one page, wrong kind · `page-kind.test.js`, `extension-tab-pages.test.js` |
| Direct application form (Greenhouse, Workday, Lever, multi-step) | filled from the kit, Submit untouched | `flow.js`, `background.js` consider/fill | e2e: Greenhouse-like, Workday-shaped, Lever-like, multi-step |
| Upload slots of any shape (input, hidden input, drop zone, + that creates the input): CV and cover letter by meaning, a miss reported by fingerprint | each file into the slot that asks for it; unknown wording left empty and reported; a missing CV listed as to do | `page/upload.js`, `page/skeleton.js` `uploadSlots`, `page/fill.js` | unit: `e2e/test/upload-slot.test.mjs` (shapes; `JP_LIVE=1` on the real Coop form), `worker/test/upload.test.js` |
| Posting → Apply link or form into a new tab → same tab, posted data kept | the link/form is pointed at this tab before the click | `background.js` pressApply | e2e: Apply opens a new tab · `extension-same-tab.test.js` |
| Apply opens its form from the page's script: followed, posting closed | the new tab is the application; the posting closes only if it is the pressed tab, still on that page | `same-tab.js`, `tabs.js` closePosting | e2e: side by side · `extension-same-tab.test.js` |
| A form drawn late (a spinner first, or a sign-in that redirects to it): its own submit never pressed as Apply; filled once its fields come | an empty page judged "no form" is read again for 20 s; when fields come the panel is put back and the page judged again, then filled; Apply never presses a submit whose form has fields or a control the site names submit/save | `fill-flow.js` watchForFields, applyCandidates `submits`, `tab-pages.js` pickApplyButton | e2e: a form drawn after a spinner · `extension-tab-pages.test.js` |
| Two applications side by side: one tab and its own kit each | a tab carries its session (`session:<tab>`); a session follows its newest tab; older tabs go quiet | `tabs.js` followOpener, `background.js` review relay, `desktop/lib/review.js` pick | e2e: side by side · `review.test.js` |
| Sign-up page before the form: account step kept apart | account page: not filled, nothing learned, "Create account" is not a submit; session at the account step | `tab-pages.js` isAccountPage, `account.js` guards, `lib/session-flow.js` reported, `lib/review.js` | e2e: sign-up page · `extension-tab-pages.test.js`, `review.test.js` |
| Sign-in page before the form with a saved password: filled, pressed once, the form behind it filled; a refused sign-in never retried | email filled by the normal fill, password by the account step; "Sign in" pressed once on the account AI's "ready"; the form behind it filled from the kit; Credentials lists the host · a refused sign-in: pressed once, never again, Claude offered | `account-step.js` accountMove/judge, `fill-flow.js` (sign_in → your details), `lib/ext-server-handlers.js` site-password (mode), `lib/keychain.js` | e2e: sign-in page (applyflows, run-only password store) · `account-step.test.js` |
| A menu whose choices are not the answer's words: the choice that means the same, then remembered per site | the AI picks the choice that means the same, the menu is armed with it, and it is remembered per site and field: the next form there gets it with no AI call | `lib/menu-rearm.js`, `lib/option-pick.js`, `lib/menu-choices.js`, `fill-flow.js` | e2e: menu whose choices · `option-pick.test.js`, `menu-choices.test.js` |
| "Needs your attention" from the extension's fill: a left field with its proposal and the form's choices; Use fills it | a field left empty carries what the fill proposed; the session page lists it with the form's own choices; Use fills it through the extension | `page/propose.js`, `review.js` proposals, `renderer/pages/need-proposal.js` | e2e: "Needs your attention" from · `need-proposal.test.js` |
| An upload slot that appears only when + is pressed (SuccessFactors) | the app's CV reaches it through the whole chain | `page/upload.js`, `page/skeleton.js` uploadSlots | e2e: appears only when + is pressed · `upload-slot.test.mjs` (shapes) |
| A form drawn with collapsed sections (SuccessFactors) | its closed sections are opened by structure, the questions inside are read and filled | `extension/sections.js` | e2e: a form with collapsed sections (**E2E-unverified**: not run locally, CI runs it) · `page-sections.test.js` (shapes) |
| Account and application on one page: it is the form | file upload / text box + password → `form`; passwords stay account fields | `tab-pages.js` pageRole, `review.js` byYou | e2e: one page · `extension-tab-pages.test.js` |
| Form tab closed → the app sees it → Reopen fills it again | "The form tab was closed", Reopen opens it with `#jobpilotto-fill` for the same session | `session-handlers.js` sessionReopen, `renderer/session-state.js` tabClosed | e2e: tab is closed · `form-tab-closed.test.js`, `session-state.test.js` |
| A second browser with the extension (another profile, a test Chrome): each browser's tabs kept apart, its report never closes another's form | each tab report carries a `browser` id (one per Chrome profile, kept across restarts); the app keeps each browser's tabs, a restart replaces its own, one silent 90 s is gone | `tab-report.js` browserId, `desktop/lib/review.js` noteTabs/tabOpen, `server.js` openTabs | e2e: second browser · `tab-identity.test.js` |
| Open in Chrome: the session's own tab by its id; two sessions on one form address never take each other's tab | the tab id its reports came from first; another session's tab, or an address two sessions share, is never taken | `form-tab.js` chooseTab, `apply-handlers.js` showForm | `form-tab.test.js` |
| Multi-step application: the next step is pressed when the person turned it on, never a control that submits | the form judge names the next step's control for this page state (a middle step, one of the page's buttons); with Settings → "Go to the next step of an application for me" on, pressed once per page state; never a control that submits a form or reads like Submit | `form-judge.js`, `next-step.js`, `form-ready.js` | `form-judge.test.js`, worker `next-step.test.js` |
| The person submits → Applied, session leaves the list | the page after Submit is read; Applied in Notion | `background.js` watchSubmission | e2e: person submits a form |
| Claude takes over an account page; the unfilled tab closes | stuck `account` → Claude starts; the form tab closes if nothing was filled there | `lib/session-flow.js` stuck/handOver, `apply.js` accountTakeOver/formTabsAtHandOver | `apply-form-session.test.js`, `session-flow.test.js` |
| Start-up "Checking…", then "Chrome isn't reporting" | no stale state while unknown; Open Chrome when the extension is silent | `renderer/session-state.js` checkingTabs/chromeSilent | `session-state.test.js` |
| Never submits, never contacts another host | across every step above | the whole suite | e2e: through all of it |

## Changing a flow

1. Find its row above. If the scenario is new, add a row here **and** in `desktop/e2e/flows.mjs` `MATRIX`, with an e2e step or unit test that fails before your change.
2. Change the code; keep the decision in `pageRole()` (no second classifier).
3. Run your row's step (E2E_STEPS) or test; for a big change to the decision core, `cd desktop && npm run flows` (all rows). CI runs every row with the other e2e.
4. Logs to read first: `logs/app.log` areas `review` (which tab is which session's, stages, tab gone), `extension` (page roles, presses, account skips).

<details><summary>Self-checks</summary>

`desktop/test/flows-matrix.test.js` fails when a row's step is renamed, a unit file is missing, a flow file is gone, or this page misses a scenario.
</details>

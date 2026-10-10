# One owner for the application journey (10 Oct 2026)

> **Verdict:** where an application stands (which tab is whose, which step, what the person must do) gets ONE owner on each side, a fast
> scenario gate that runs before every push touching it, decisions that expire, and invariants written at the top of each core module.
> Approved by the owner on 10 Oct 2026 ("let's implement all your proposed points").

## Why (evidence, 10 Oct 2026)
- 8 days on `main`: `extension/background.js` 48 commits, `fill-flow.js` 29, `account-step.js` 16, `ext-server-handlers.js` 15, `terminals.js` 13;
  66 subjects of the week say "again / revert / restore / regress".
- One live run showed three bugs of the same state: the sign-in tab had no session id (`session:<tab>` is written in 3 files, read in 6), a card
  said "can't reach the form" while the tab was at the account step, and a pending account's page was left untouched with no word to the person.
- The step lives in five fields (`stuck`, `stage`, `accountState`, `accountStep`, `accountNeeds`, plus `note`) set by four functions from four callers;
  the renderer re-derives the step from them in two places (`sessionState`, `sessionStage`).
- The journey is only checked on CI after a push (flows matrix) or by hand in the twin.

## What changes
| # | Change | Where |
|---|---|---|
| 1 | **App journey owner:** a pure reducer `journey(record, event) -> record` with one derived view; `terminals.js` keeps its four functions as thin callers of it, so no caller changes in the first step | `desktop/lib/application-journey.js` |
| 2 | **One session resolver:** every extension→app event carries the tab's identity `{session, job, tab}`; the app resolves the session one way (id, else the job's posting, else nothing) and answers the id it used, which the extension binds to the tab | `desktop/lib/journey-identity.js`, its callers |
| 3 | **Extension tab identity owner:** the per-tab keys `session/job/from/armed/carried` read and written only through one module | `extension/tab-identity.js` |
| 4 | **Scenario gate:** each scenario of `docs/flows/applying.md` is a sequence of events fed to the reducer (and the resolver) with the expected card; runs in seconds; the push hook runs it when a flow-core file changed | `desktop/test/journeys.test.js`, `tools/pre-push-check.sh` |
| 5 | **Expiring memory:** every kept decision has an age limit and is dropped when contradicted: the popup/cookie button choice, a pending site account (re-checked, then retried as a sign-in after 24 h) | `desktop/lib/option-pick.js`, `popup-pick.js`, `site-accounts.js` |
| 6 | **Invariants block** at the top of each flow-core module, each rule with one test | flow-core files |
| 7 | **Workflow:** one session owns the flow core at a time (claimed by message, released by message); no new applying features while 1–4 land | `CLAUDE.md`, `CONTRIBUTING.md` |

## The journey record (app)
`{step, needs, account: {host, mode, state}, reachedForm}`
- `step`: `posting | account | confirm | code | form | ready | ended` (one value; the card's wording comes from it alone).
- `needs`: what only the person can do now (`''` when nothing): a code, a bot check, a consent, a field. Fixed meanings, the AI's words for the label.
- Events: `opened`, `account-page {host, accountStep}`, `account-pressed {state}`, `confirm-result {outcome}`, `stuck {why, needs}`, `form-report {total, left}`, `ended {outcome}`.
- The public view keeps today's field names (`stuck`, `stage`, `accountState`, `accountNeeds`, `accountStep`, `accountHost`, `note`), derived from the record, so screens change later and one at a time.

## Invariants (each with a test)
- The step never goes back on a report from a tab the session has left (an older tab's "no form" never undoes the account step).
- An account page's fields are never counted as the form's progress.
- `incomplete` (a fill that put nothing in) stays until something is filled.
- A pending account always gives the person a next action (`needs` set) once the confirmation check has run.
- Apply is pressed once per tab and page; only a reload or the person's "Apply on this page" clears it (dede94a, 6065c87).
- A popup is closed before the page is read; a link that leaves the page is never pressed (fdd9638).
- A middle step's Next is pressed under the Submit floors; Submit never.

## Data ownership
Journey state is runtime state of an application on this Mac (the sessions cache, `terminals.js` `save()`), not user data: nothing new goes to
Notion or the store interface. Site accounts stay in `settings.siteAccounts` (unchanged shape; `at` is now used for the age limit). No new column.

## Landing order (one push each, each with its tests)
1. Reducer + terminals delegates (no behaviour change; the existing tests pass unchanged) + scenario tests of today's three bugs (failing first where they fail today).
2. Resolver (app) + identity carried by the extension; today's lost session id fixed.
3. Extension `tab-identity.js`; key writes moved behind it.
4. Gate in the push hook.
5. Expiring memory.
6. Invariants headers; workflow rules in `CLAUDE.md`.

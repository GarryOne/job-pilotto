// How an application ended, as one fixed word (owner, 9 Oct 2026: "how many forms were submitted, how many failed, how many assisted"). Counted per board and day with the
// other flow counts (lib/recipes.js flow → site flow_outcomes), never a company, a role, an address or a word of the page. Pure: the site imports the list too (site/src/knowledge.js).
//   submitted-clean     you pressed Submit and the extension had filled every required field: you changed nothing
//   submitted-assisted  you submitted, but answered or corrected at least one field yourself
//   submitted-claude    the application was finished through Apply with Claude (the backup)
//   failed-no-form      the extension could not reach the form
//   failed-account      it stopped at the sign-in or sign-up: a bot check, a code, something only you could give
//   failed-abandoned    not submitted for any other reason (the tab closed, the session ended, you chose not to)
// Cancelled or restarted sessions are not an application's end: no word. Guard: test/application-result.test.js.
export const RESULT_STATES = ['submitted-clean', 'submitted-assisted', 'submitted-claude', 'failed-no-form', 'failed-account', 'failed-abandoned'];

// session: the app's session record (kind, outcome, stuck); state: the form's last review state (its filled fields say who filled each).
export function resultOf(session, state) {
  if (!session || !['form', 'claude'].includes(session.kind)) return '';
  if (session.outcome === 'submitted') {
    if (session.kind === 'claude') return 'submitted-claude';
    return (state?.filled || []).some(field => field?.by === 'you') ? 'submitted-assisted' : 'submitted-clean';
  }
  if (session.outcome === 'not submitted') return session.stuck === 'no-form' ? 'failed-no-form' : session.stuck === 'account' ? 'failed-account' : 'failed-abandoned';
  return '';
}

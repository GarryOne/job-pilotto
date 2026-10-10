// The steps of a session in plain words ("What happened", pages/session-steps.js draws them). No imports and no window: test/session-steps.test.js feeds it sessions and
// form reports. `submitted` and `time` come from the page (session-state.js isSubmitted, activity.js clockTime).
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// → [{tone: 'done'|'warn'|'now', text}], oldest first. Pure: the test feeds it sessions and form reports.
export function sessionSteps(item, state = null, {submitted = false, time = at => at} = {}) {
  const steps = [{tone: 'done', text: `Opened the job in Chrome${item.startedAt ? ` · ${time(item.startedAt)}` : ''}`}];
  if (item.stuck === 'account') steps.push({tone: 'warn', text: item.note || 'This site needs an account'});
  else if (item.stuck === 'incomplete') steps.push({tone: 'warn', text: item.note || 'Nothing could be filled; required fields are empty'});
  else if (item.stuck === 'email') steps.push({tone: 'warn', text: item.note || 'This job is applied to by email'});   // the address is in the note: nothing is sent for you
  else if (item.stuck === 'no-form') steps.push({tone: 'warn', text: /^Needs you:/.test(item.note || '') ? item.note : 'No application form found on the page yet'});   // a bot check in front of the form says so
  const total = Number(state?.total) || 0, left = Math.max(0, Number(state?.left) || 0);
  if (total && !state.account) {
    steps.push({tone: 'done', text: `Read the form: ${plural(total, 'required field')}`});
    steps.push({tone: 'done', text: `Filled ${total - left} of ${total}`});
    const suggested = (state.proposals || []).filter(proposal => proposal?.value).length;
    if (suggested) steps.push({tone: 'done', text: `${plural(suggested, 'answer')} suggested for you to check`});
  }
  if (submitted) steps.push({tone: 'done', text: 'Submitted · marked Applied'});
  else if (item.status === 'running' && (item.note || 'Working…') !== steps.at(-1).text) steps.push({tone: 'now', text: item.note || 'Working…'});   // never the line just said (an email posting's note is its warning)
  else if (total && !state.account) steps.push({tone: 'now', text: left ? `Your turn: ${plural(left, 'field')} left, then submit in Chrome` : 'Your turn: review and submit in Chrome'});
  return steps;
}


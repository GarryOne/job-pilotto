// The words of Strategy's "scored using previous search settings" notice and its Re-score dialog, kept free of the DOM so the tests can check them
// (pages/strategy-rescore.js draws them). Guarded by test/strategy-rescore.test.js.
export const jobs = count => `${count} job${count === 1 ? '' : 's'}`;
export const noticeTitle = count => `${jobs(count)} ${count === 1 ? 'was' : 'were'} scored using previous search settings.`;
export const reasonsText = ({method = 0, places = 0} = {}) =>
  [method && `${jobs(method)}: an older way of scoring`, places && `${jobs(places)}: other places than your current ones`].filter(Boolean).join(' · ');
export const dialogLead = count => `They are scored again with your current settings, with AI, once. A search starts now and scores up to 60 of them${
  count > 60 ? '; the rest in the next searches' : ''}. Cost: not calculated. Your applications and their stages are not changed.`;


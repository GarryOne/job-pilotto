// Which tab may the extension touch? Chrome reuses a tab id after its tab closes, and the extension keeps per-tab
// state in session storage, so an id that comes back showing something else must never inherit a fill, a progress
// box or a "you submitted" check. 1 Oct 2026: a fill's box was painted onto a Google search page, and the
// submitted-check read the text of any other host.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {confirmationOf, forJob, missedConfirmation, originOf, pageKey, samePage, sameSite, tabArmed} from '../../extension/tab-pages.js';

const JOB = 'https://job-boards.greenhouse.io/canonical/jobs/3014391';

test('the panel runs only on a tab the desktop app opened', () => {
  assert.equal(tabArmed({url: `${JOB}#jobpilotto-fill`}), true);
  assert.equal(tabArmed({url: 'https://calendly.com/acme/30min', armed: true}), true);
  assert.equal(tabArmed({url: 'https://calendly.com/acme/30min'}), false);
  assert.equal(tabArmed({url: JOB}), false);
  assert.equal(tabArmed({}), false);
});

test('the same page ignores the fill marker and a trailing slash', () => {
  assert.equal(samePage(`${JOB}#jobpilotto-fill`, JOB), true);
  assert.equal(samePage(`${JOB}/`, JOB), true);
  assert.equal(samePage(JOB, 'https://job-boards.greenhouse.io/canonical/jobs/5002072'), false);
  assert.equal(samePage('', JOB), false);
  assert.equal(samePage(JOB, undefined), false);
  assert.equal(pageKey(`${JOB}?utm=x#jobpilotto-fill`), `${JOB}?utm=x`);
});

test('a fill may keep drawing while the form moves inside its own site, never onto another', () => {
  const page = 'https://boards.greenhouse.io/acme/jobs/1';
  assert.equal(sameSite('https://boards.greenhouse.io/acme/jobs/1/apply', page), true);   // the ATS's next step
  assert.equal(sameSite('https://www.google.com/search?q=dubai+time', page), false);        // a random page
  assert.equal(sameSite('http://boards.greenhouse.io/acme/jobs/1', page), false);           // another scheme
  assert.equal(sameSite('not a url', page), false);
  assert.equal(originOf('https://x.test/a'), 'https://x.test');
  assert.equal(originOf(''), '');
});

test('only the job\'s own page or its confirmation counts as "this job"', () => {
  assert.equal(forJob(JOB, JOB), true);
  assert.equal(forJob(`${JOB}#jobpilotto-fill`, JOB), true);
  assert.equal(forJob('https://job-boards.greenhouse.io/canonical/jobs/3014391/confirmation', JOB), true);
  assert.equal(forJob('https://jobs.lever.co/acme/abc/thanks', 'https://jobs.lever.co/acme/abc'), true);
  // The case that was wrong: any other host passed (`elsewhere`), so a Google search page was read.
  assert.equal(forJob('https://www.google.com/search?q=thank+you+for+applying', JOB), false);
  assert.equal(forJob('https://job-boards.greenhouse.io/canonical/jobs/5002072', JOB), false);  // another role
  assert.equal(forJob('', JOB), false);
  assert.equal(forJob(JOB, ''), false);
});

test('a confirmation page with no stored job is logged, and only that page', () => {
  const page = 'https://job-boards.greenhouse.io/anthropic/jobs/5114768008/confirmation?token=secret';
  assert.deepEqual(confirmationOf(page), {host: 'job-boards.greenhouse.io', id: '5114768008', path: 'confirmation'});
  assert.equal(confirmationOf(JOB), null);
  assert.equal(confirmationOf('https://www.google.com/search?q=thank+you+for+applying'), null);
  assert.deepEqual(missedConfirmation({url: page}), {
    text: 'confirmation page, no job stored on this tab: not marked',
    fields: {host: 'job-boards.greenhouse.io', id: '5114768008', path: 'confirmation'},
  });
  assert.equal(missedConfirmation({url: page, job: 'https://job-boards.greenhouse.io/anthropic/jobs/5114768008'}), null);
  assert.equal(missedConfirmation({url: page, job: 'https://job-boards.greenhouse.io/anthropic/jobs/5002072'}).text,
    'confirmation page is not the job stored on this tab: not marked');
});

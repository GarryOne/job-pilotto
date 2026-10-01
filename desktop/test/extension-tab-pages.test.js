// Which tab may the extension touch? Chrome reuses a tab id after its tab closes, and the extension keeps per-tab
// state in session storage, so an id that comes back showing something else must never inherit a fill, a progress
// box or a "you submitted" check. 1 Oct 2026: a fill's box was painted onto a Google search page, and the
// submitted-check read the text of any other host.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {useTabVerdict, confirmationOf, forJob, missedConfirmation, neverForm, originOf, pageFingerprint, pageKey, pageRole, samePage, sameSite, submissionOutcome, SUBMIT_SETTLE_MS, SUBMIT_WAIT_MS, tabArmed} from '../../extension/tab-pages.js';

const JOB = 'https://job-boards.greenhouse.io/canonical/jobs/3014391';

test('the panel runs only on a tab the desktop app opened', () => {
  assert.equal(tabArmed({url: `${JOB}#jobpilotto-fill`}), true);
  assert.equal(tabArmed({url: 'https://calendly.com/acme/30min', armed: true}), true);
  assert.equal(tabArmed({url: 'https://calendly.com/acme/30min'}), false);
  assert.equal(tabArmed({url: JOB}), false);
  assert.equal(tabArmed({}), false);
});

test('a later page is a form, an account page, or neither', () => {
  assert.equal(pageRole({fields: 1}), 'no-form'); // a search box, or a job page with only an Apply button
  assert.equal(pageRole({}), 'no-form');
  assert.equal(pageRole({passwords: 1, fields: 2}), 'account'); // sign in
  assert.equal(pageRole({passwords: 2, fields: 8}), 'account'); // sign up: still Claude's, never auto-filled
  assert.equal(pageRole({fields: 12}), 'form');
  assert.equal(pageRole({fields: 1, files: 1}), 'form');
  assert.equal(pageRole({textareas: 1}), 'form');
});

test('a submit is asked about once the page changes, with or without a redirect', () => {
  const form = 'https://jobs.example/acme/apply';
  const at = 1_000;
  const before = pageFingerprint({title: 'Apply', headings: ['Apply'], text: 'First name', inputs: 8});
  const same = pageFingerprint({title: 'Apply', headings: ['Apply'], text: 'First name', inputs: 8});
  const thanks = pageFingerprint({title: 'Thank you', headings: ['Application received'], text: 'We have received your application', inputs: 0});
  assert.equal(before, same);
  assert.notEqual(before, thanks);
  assert.equal(submissionOutcome({at, now: at + 3000, from: form, to: form, before, after: same, stableFor: 3000}).why, 'waiting');
  assert.equal(submissionOutcome({at, now: at + SUBMIT_WAIT_MS, from: form, to: form, before, after: same, stableFor: 3000}).why, 'unchanged');
  const stayed = submissionOutcome({at, now: at + 5000, from: form, to: form, before, after: thanks, stableFor: SUBMIT_SETTLE_MS});
  assert.equal(stayed.ask, true);
  assert.equal(stayed.why, 'content');
  assert.equal(submissionOutcome({at, now: at + 3000, from: form, to: form, before, after: thanks, stableFor: 500}).why, 'waiting');
  const moved = submissionOutcome({at, now: at + 5000, from: form, to: `${form}/done?token=secret`, before, after: thanks, stableFor: SUBMIT_SETTLE_MS});
  assert.equal(moved.ask, true);
  assert.equal(moved.why, 'redirect');
  assert.equal(moved.path.endsWith('/done'), true);
  assert.equal(JSON.stringify(moved).includes('secret'), false);
  assert.equal(submissionOutcome({at, now: at + SUBMIT_WAIT_MS + 1, from: form, to: `${form}/done`, before, after: thanks, stableFor: 5000}).why, 'submit too old');
  assert.equal(submissionOutcome({now: at, from: form, to: `${form}/done`}).why, 'no submit');
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

test('the fill mark goes on the tab\'s own address, once', async () => {
  const {markedUrl} = await import('../lib/form-tab.js');
  assert.equal(markedUrl('https://job-boards.greenhouse.io/embed/job_app?for=n26&token=1'), 'https://job-boards.greenhouse.io/embed/job_app?for=n26&token=1#jobpilotto-fill');
  assert.equal(markedUrl('https://x.io/a#jobpilotto-fill'), '');
  assert.equal(markedUrl('chrome://extensions'), '');
});

test('a session\'s form counts as open only while a tab for it is reported (an embedded form included)', async () => {
  const {mergeTabs, withOpenForm} = await import('../lib/form-tab.js');
  const session = {id: 'a1', url: 'https://job-boards.greenhouse.io/n26/jobs/7768035', company: 'N26'};
  const embed = 'https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035';
  assert.deepEqual([...withOpenForm([session], mergeTabs([embed], []))], ['a1']);
  assert.deepEqual([...withOpenForm([session], mergeTabs([], []))], []);
  assert.deepEqual([...withOpenForm([session], mergeTabs(['https://jobs.lever.co/other/1'], []))], []);
});

test('an embedded Greenhouse confirmation carries the job id in ?token=, and counts for that job', async () => {
  const {forJob} = await import('../../extension/tab-pages.js');
  const job = 'https://job-boards.greenhouse.io/n26/jobs/7768035';
  assert.equal(forJob('https://job-boards.greenhouse.io/embed/job_app/confirmation?for=n26&token=7768035', job), true);
  assert.equal(forJob('https://job-boards.greenhouse.io/embed/job_app/confirmation?for=n26&token=1111111', job), false);
  assert.equal(forJob('https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035', job), false);  // the form, not a confirmation
});

test('the user\'s Notion is never a job form: an armed tab sent there is let go', () => {
  assert.equal(neverForm('https://app.notion.com/p/Staff-Software-Engineer-6b262be8'), true);
  assert.equal(neverForm('https://www.notion.so/Job-Tracker'), true);
  assert.equal(neverForm('https://acme.notion.site/careers'), true);
  assert.equal(neverForm('https://job-boards.greenhouse.io/scaleai/jobs/4719479005'), false);
  assert.equal(neverForm('https://notion.example.org/apply'), false);
  // A search results page (Claude researching a company in the armed tab) is never a form; a real form on a Google host still is.
  assert.equal(neverForm('https://www.google.com/search?q=cursor+who+sits+behind'), true);
  assert.equal(neverForm('https://www.google.ch/search?q=acme'), true);
  assert.equal(neverForm('https://www.bing.com/search?q=acme'), true);
  assert.equal(neverForm('https://duckduckgo.com/?q=acme'), true);
  assert.equal(neverForm('https://docs.google.com/forms/d/e/abc/viewform'), false);
  assert.equal(neverForm('https://careers.google.com/jobs/results/123/apply'), false);
  assert.equal(neverForm('not a url'), false);
});

test('"Use on this tab" is off on a search page, a non-https page and a page with no form; on for a form or an unreadable page', () => {
  assert.equal(useTabVerdict('https://www.google.com/search?q=acme', 'no-form').ok, false);
  assert.match(useTabVerdict('https://www.google.com/search?q=acme').why, /No form detected.*search or Notion/);
  assert.equal(useTabVerdict('http://example.com/apply', 'form').ok, false);
  assert.equal(useTabVerdict('chrome://extensions').ok, false);
  assert.equal(useTabVerdict('https://careers.acme.com/jobs/1', 'no-form').ok, false);
  assert.match(useTabVerdict('https://careers.acme.com/jobs/1', 'no-form').why, /No form detected/);
  assert.equal(useTabVerdict('https://careers.acme.com/jobs/1', 'form').ok, true);
  assert.equal(useTabVerdict('https://careers.acme.com/jobs/1', 'account').ok, true);
  assert.equal(useTabVerdict('https://careers.acme.com/jobs/1', null).ok, true);   // couldn't be read: not blocked on a guess
});

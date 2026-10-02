// The form lab's decisions (tools/form-lab-lib.mjs): which page holds a form, what the test applicant answers, and when a candidate
// recipe has earned a canary.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applicationUrl, decidePromotion, runsFrom, siteOf, testAnswer} from '../../tools/form-lab-lib.mjs';

test('the form is one level below the posting on Ashby and Lever, and the page is kept clean', () => {
  assert.equal(applicationUrl('https://jobs.ashbyhq.com/openai/621bb104-9daa-4c9e-949a-03d5730334e8'), 'https://jobs.ashbyhq.com/openai/621bb104-9daa-4c9e-949a-03d5730334e8/application');
  assert.equal(applicationUrl('https://jobs.ashbyhq.com/openai/abc/application#x'), 'https://jobs.ashbyhq.com/openai/abc/application');
  assert.equal(applicationUrl('https://jobs.lever.co/acme/123/'), 'https://jobs.lever.co/acme/123/apply');
  assert.equal(applicationUrl('https://job-boards.greenhouse.io/scaleai/jobs/4719479005'), 'https://job-boards.greenhouse.io/scaleai/jobs/4719479005');
  assert.equal(applicationUrl('not a url'), '');
  assert.deepEqual(['https://boards.greenhouse.io/x', 'https://jobs.ashbyhq.com/x', 'https://api.easytemp.ch/x'].map(siteOf), ['greenhouse', 'ashby', 'api.easytemp.ch']);
});

test('the test applicant answers Yes where offered, else the first choice, and a date', () => {
  assert.equal(testAnswer('toggle-group', ['No', 'Yes']), 'Yes');
  assert.equal(testAnswer('toggle-group', ['Male', 'Female']), 'Male');
  assert.equal(testAnswer('toggle-group', []), '');
  assert.equal(testAnswer('date'), '2026-11-01');
});

test('operator results become rows for the site: failures with a reason, nothing without a fingerprint', () => {
  assert.deepEqual(runsFrom('ashby', [{fp: '1d2pcapx18', kind: 'toggle-group', recipe: 0, ok: true}, {fp: 'abc123', kind: 'date', ok: false, why: 'the field did not keep the date'}, {kind: 'x', ok: true}]),
    [{site: 'ashby', fingerprint: '1d2pcapx18', kind: 'toggle-group', recipe: 0, ok: true, why: '', url: ''},
      {site: 'ashby', fingerprint: 'abc123', kind: 'date', recipe: 0, ok: false, why: 'the field did not keep the date', url: ''}]);
  assert.equal(runsFrom('ashby', [{fp: 'abc123', kind: 'date', ok: true}], 'https://jobs.ashbyhq.com/a/1/application')[0].url, 'https://jobs.ashbyhq.com/a/1/application');
});

test('a candidate recipe earns a canary only with enough tries, on enough different pages, that mostly worked', () => {
  const tries = (n, ok, pages) => Array.from({length: n}, (_, i) => ({page: `https://p${i % pages}.example/`, ok: i < ok}));
  assert.equal(decidePromotion(tries(10, 10, 4)).promote, true);
  assert.equal(decidePromotion(tries(4, 4, 4)).promote, false);    // too few tries
  assert.equal(decidePromotion(tries(10, 10, 1)).promote, false);  // one page only
  assert.equal(decidePromotion(tries(10, 8, 5)).promote, false);   // 80% is not enough
  assert.equal(decidePromotion([]).promote, false);
});

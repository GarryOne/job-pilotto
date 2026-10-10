// The pool table's two words (src/platform.js): the platform an application runs on, from a host; the flow a signature tests, in words.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {flowOf, platformOf, signatureHost} from '../src/platform.js';

test('platform: a known ATS host by its structure, anything else is Custom', () => {
  const cases = {'redhat.wd5.myworkdayjobs.com': 'Workday', 'career5.successfactors.eu': 'SuccessFactors', 'job-boards.greenhouse.io': 'Greenhouse', 'jobs.ashbyhq.com': 'Ashby',
    'jobs.eu.lever.co': 'Lever', 'jobs.smartrecruiters.com': 'SmartRecruiters', 'acme.jobs.personio.de': 'Personio', 'acme.recruitee.com': 'Recruitee', 'acme.teamtailor.com': 'Teamtailor',
    'recruitingapp-2663.umantis.com': 'Umantis', 'apply.workable.com': 'Workable', 'join.com': 'Join', 'careers.example.ch': 'Custom', '': 'Custom'};
  for (const [host, platform] of Object.entries(cases)) assert.equal(platformOf(host), platform, host);
  assert.equal(platformOf('evilgreenhouse.io'), 'Custom');   // a suffix on a label boundary only
});

test('flow: the signature in words; a leading "other" page straight into a form on the same host is the same flow', () => {
  assert.equal(flowOf('posting>account>form@x.com#form', 'x.com').flow, 'posting → account → form');
  assert.equal(flowOf('posting>account-form@x.com#ready').flow, 'posting → account and form on one page');
  assert.equal(flowOf('posting>account@x.com#code/bot').flow, 'posting → account → bot check');
  assert.equal(flowOf('posting@x.com#code/bot').flow, 'posting → bot check');
  const a = flowOf('form@job-boards.greenhouse.io#form', 'job-boards.greenhouse.io'), b = flowOf('other>form@job-boards.greenhouse.io#form', 'job-boards.greenhouse.io');
  assert.equal(a.flow, b.flow);
  assert.equal(b.raw, 'other>form@job-boards.greenhouse.io#form');   // the raw signature stays, for the tooltip
  assert.notEqual(flowOf('other>form@ats.com#form', 'employer.com').flow, a.flow);   // another host: a different journey, kept apart
  assert.equal(flowOf('unclear').flow, 'unclear');
  assert.equal(flowOf('').flow, null);
  assert.equal(signatureHost('posting>form@x.com#form'), 'x.com');
});

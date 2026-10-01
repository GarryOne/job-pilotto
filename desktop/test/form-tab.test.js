import assert from 'node:assert/strict';
import {test} from 'node:test';
import {closeFormTab, listTabs, mergeTabs, pickTab, reloadFormTab, reloadTarget, withOpenForm} from '../lib/form-tab.js';

const tabs = [
  {win: 1, index: 1, url: 'https://news.ycombinator.com/', title: 'Hacker News'},
  {win: 1, index: 2, url: 'https://www.example-labs.com/careers', title: 'Careers | Example Labs'},
  {win: 2, index: 1, url: 'https://job-boards.greenhouse.io/examplelabs/jobs/7012345?gh_src=abc', title: 'Job Application for SRE at Example Labs'},
  {win: 2, index: 2, url: 'https://mail.google.com/mail/u/0/', title: 'Inbox'},
];

test('the form tab: the job ID in its URL wins over the company\'s careers page', () => {
  assert.equal(pickTab(tabs, {url: 'https://www.example-labs.com/careers/jobs?gh_jid=7012345', company: 'Example Labs'}).index, 1);
  assert.equal(pickTab(tabs, {url: 'https://www.example-labs.com/careers/jobs?gh_jid=7012345', company: 'Example Labs'}).win, 2);
});

test('the posting itself, then an application-form host naming the company, then nothing', () => {
  assert.equal(pickTab(tabs, {url: 'https://www.example-labs.com/careers/', company: 'Other'}).win, 1);
  assert.equal(pickTab(tabs, {url: 'https://jobs.example/examplelabs/sre', company: 'Example Labs'}).win, 2);
  assert.equal(pickTab(tabs, {url: 'https://jobs.example/acme/sre', company: 'Acme Robotics'}), null);
});

test('at start: which sessions still have their form open, one tab per session, the job ID first', () => {
  const open = [
    {url: 'https://job-boards.greenhouse.io/canonical/jobs/7100001', title: 'Job Application for Site Reliability Engineer at Canonical'},
    {url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890', title: 'Job Application for Staff+ Engineer at Anthropic'},
    {url: 'https://mail.google.com/', title: 'Inbox'},
  ];
  const sessions = [
    {id: 'c1', company: 'Canonical', url: 'https://canonical.com/careers/7100002'},  // its tab was closed
    {id: 'c2', company: 'Canonical', url: 'https://canonical.com/careers/7100001'},  // its job ID is in the open tab
    {id: 'a1', company: 'Anthropic', url: 'https://www.anthropic.com/jobs/4567890'},
    {id: 'n1', company: 'N26', url: 'https://n26.com/careers/1234567'},
  ];
  assert.deepEqual([...withOpenForm(sessions, open)].sort(), ['a1', 'c2']);  // the one Canonical tab goes to the matching job only
  assert.deepEqual([...withOpenForm(sessions, [])], []);
});

test('reloading a tab takes the same confident match — never a guess at someone else\'s tab', () => {
  const job = {url: 'https://www.example-labs.com/careers/jobs?gh_jid=7012345', company: 'Example Labs'};
  assert.equal(reloadTarget(tabs, job).index, 1);   // the Greenhouse tab carrying the posting's job ID
  assert.equal(reloadTarget(tabs, job).win, 2);
  // A better match elsewhere still wins, and a 50 (the company in a title, nothing else) is below the bar.
  assert.equal(reloadTarget(tabs, {url: 'https://jobs.example/examplelabs/sre', company: 'Example Labs'}).win, 2);
  assert.equal(reloadTarget([{win: 1, index: 1, url: 'https://www.example-labs.com/careers', title: 'Careers | Example Labs'}],
    {url: 'https://jobs.example/examplelabs/sre', company: 'Example Labs'}), null);
  assert.equal(reloadTarget(tabs, job, 85), null);  // below the bar: no confident match, so no reload on a guess
  assert.equal(reloadTarget(tabs, {url: 'https://www.example-labs.com/careers/', company: 'Example Labs'}).win, 1);  // the posting itself
  assert.equal(reloadTarget([], job), null);
});

// Chrome's scripting dictionary is macOS-only, so off a Mac there are no tabs to see, close or reload, and asking is
// the user's job. It must not answer 'no-chrome' there: the window turns that into "Google Chrome isn't running",
// which is untrue when Chrome is open in front of them.
test('off a Mac, Chrome cannot be scripted: no tabs, nothing closed, and the reload is the user\'s to do', async () => {
  const job = {url: 'https://job-boards.greenhouse.io/examplelabs/jobs/7012345', company: 'Example Labs'};
  assert.deepEqual(await listTabs('win32'), []);
  assert.equal(await closeFormTab(job, 'win32'), false);
  assert.equal(await reloadFormTab(job, 'win32'), 'manual');
});

test('the open-form tabs come from the extension first, with Chrome\'s own scripting added where it knows more', () => {
  // The extension reports every browser it runs in, but only URLs; Chrome's scripting has titles but reaches one
  // instance — so a tab only the extension saw is still known to be open (the failure of 1 Oct 2026).
  const reported = ['https://job-boards.greenhouse.io/canonical/jobs/3014391#apply', 'https://jobs.lever.co/n26/abc'];
  const scripted = [{win: 1, index: 3, url: 'https://jobs.lever.co/n26/abc', title: 'N26 — Site Reliability Engineer'}];
  assert.deepEqual(mergeTabs(reported, scripted), [
    {url: 'https://job-boards.greenhouse.io/canonical/jobs/3014391#apply'},
    {win: 1, index: 3, url: 'https://jobs.lever.co/n26/abc', title: 'N26 — Site Reliability Engineer'},  // the titled one wins
  ]);
  assert.deepEqual(mergeTabs([], scripted), scripted);
  assert.deepEqual(mergeTabs(reported, []), [{url: reported[0]}, {url: reported[1]}]);
  assert.deepEqual(mergeTabs([], []), []);
});

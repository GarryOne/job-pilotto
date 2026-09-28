import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pickTab, withOpenForm} from '../lib/form-tab.js';

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

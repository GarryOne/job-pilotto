import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pickTab} from '../lib/form-tab.js';

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

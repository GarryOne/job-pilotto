// Actions keyed on a Notion page, on a store without pages (9 Oct 2026 sweep): each falls back to the app's own view instead of doing
// nothing or opening something else. Read from the source (these pages need a window); the parity scan covers the Notion side.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');

test('Interviews find their job by the store\'s id too', () => {
  assert.match(read('interview-lists.js'), /jobForPage = pageId => jobList\(\)\.find\(job => \(job\.page_id && plainId\(job\.page_id\) === plainId\(pageId\)\)/);
});

test('In conversation opens the job\'s page; a mail card\'s job and a ready prep kit open it too', () => {
  assert.match(read('jobs-render.js'), /job\.notion_url \? window\.pilot\.openNotion\(job\.notion_url, event\.metaKey\) : openJobPanel\(job\)\)/);
  const mail = read('activity-mail.js');
  assert.match(mail, /if \(kitReady\.has\(id\)\) return \{label: 'Open prep kit', run: event => \(found\.notion_url \? .* : \(openView\('jobs'\), openJobPanel\(found, 'prep'\)\)\)\}/);
  assert.match(mail, /else if \(found\.page_id\) \{ openView\('jobs'\); openJobPanel\(found\); \}/);
});

test('Focus: a ready prep kit and a reply/booking item open the job\'s page without Notion', () => {
  const focus = read('focus.js');
  assert.match(focus, /run === 'open' \? event => \(item\.notion_url \? openLink\(item\.notion_url, event\) : \(openView\('jobs'\), openJobPanel\(jobOf\(\), 'prep'\)\)\)/);
  assert.match(focus, /\(item\.notion_url \|\| item\.job_url\)\) \{\n    actions\.append\(focusButton\('Open'/);
  assert.match(focus, /primary\.run === 'open' \? event => \(item\.notion_url \? window\.pilot\.openNotion\(item\.notion_url, event\?\.metaKey\)\n      : \(openView\('jobs'\), openJobPanel\(/);
});

// Jobs → a job's page (pages/job-panel.js): every way into a job's sections reaches the panel when there is no Notion page, and ⌘K lists it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');

test('the kit chip, the rejection chip and "View rejection review" open the job page when there is no Notion page', () => {
  const rows = read('pages/jobs-render.js');
  assert.match(rows, /openPage = \(tab, event\) => \(job\.notion_url \? window\.pilot\.openNotion\(job\.notion_url, event\?\.metaKey\) : openJobPanel\(job, tab\)\)/);
  assert.match(rows, /kitLabel\(job\.kit_state\);\n.*onClick: event => openPage\('kit', event\)/);
  assert.equal((rows.match(/openPage\('review', event\)/g) || []).length, 2, 'the chip and the menu item');
  // No section entry point is gated on a Notion page any more (the store on this Mac has none).
  assert.doesNotMatch(rows, /if \(job\.kit && job\.notion_url\)|job\.rejection && job\.notion_url/);
  assert.match(rows, /label: 'Open job page', run: \(\) => openJobPanel\(job\)/);
});

test('⌘K lists every tracked job\'s page; the panel and its markup exist', () => {
  assert.match(read('pages/nav.js'), /`Open job page: \$\{job\.title\} · \$\{job\.company\}`/);
  const html = read('index.html');
  assert.match(html, /<div class="job-drawer-layer" id="job-drawer-layer" hidden>\s*<div class="job-drawer-backdrop" id="job-drawer-backdrop"><\/div>\s*<aside class="job-drawer" id="job-panel"/);
  assert.match(read('pages/job-panel.js'), /page\?\.links && job\.notion_url/, '"Open in Notion" only with a store that has pages');
});

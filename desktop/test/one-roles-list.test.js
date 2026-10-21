// The class test for the merged list (21 Oct 2026, owner: "what's the difference between these 2 cards? Let's merge them"): no screen, card, edit list,
// palette entry or settings section still shows the job board searches as a second list next to Target roles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {EDITABLE_LISTS} from '../lib/strategy.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const sources = dir => fs.readdirSync(path.join(root, dir), {recursive: true, withFileTypes: true}).filter(file => file.isFile() && /\.(js|html)$/.test(file.name))
  .map(file => path.join(file.parentPath, file.name));

test('no list, card or edit is named for job board searches any more', () => {
  assert.ok(!Object.keys(EDITABLE_LISTS).includes('queries'));
  for (const file of ['renderer/pages/strategy-cards.js', 'renderer/pages/strategy-targets.js']) {   // they need a DOM to import: read as text
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /\['queries'|\bqueries:|'queries'/, file);
  }
});

test('no renderer file shows or edits the second list under either of its names', () => {
  const seen = [];
  for (const file of sources('renderer')) {
    const text = fs.readFileSync(file, 'utf8');
    if (/jobs_board_search_queries|>Search terms<|Job board searches|data-list="queries"|chips-queries/.test(text)) seen.push(path.relative(root, file));
  }
  assert.deepEqual(seen, []);
});

test('the Notion settings page has one roles section', () => {
  const page = fs.readFileSync(path.join(root, '../src/notion/search_settings.py'), 'utf8');
  const headings = [...page.matchAll(/^\s+\('([^']+)', '(?:search|preferences)'/gm)].map(match => match[1]);
  assert.ok(headings.includes('Target roles'));
  assert.ok(!headings.includes('Roles to look for') && !headings.includes('Job board searches'), headings.join());
});

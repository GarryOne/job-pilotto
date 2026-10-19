// Jobs opens on the list (owner, 19 Oct 2026): the blocks that left Jobs are on their new page and in ⌘K, the tiles are four, and the folded Find card keeps its numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {employersRead, foldedParts} from '../renderer/find-card-model.js';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const view = name => html.split(/<div class="view" data-view="/).find(part => part.startsWith(`${name}"`)) || '';

// The class: every block moved off Jobs is drawn on Focus and has a palette entry (label in nav.js).
const MOVED = [['questions', 'Review application questions'], ['jobs-talking', 'In conversation'], ['tips-focus', null]];
test('every block moved off Jobs is on Focus, and the actions among them are in ⌘K', () => {
  for (const [id, label] of MOVED) {
    assert.ok(view('focus').includes(`id="${id}"`), `${id} is on Focus`);
    assert.ok(!view('jobs').includes(`id="${id}"`), `${id} is not on Jobs any more`);
    if (label) assert.match(read('pages/nav.js'), new RegExp(`add\\('Focus', '${label}'`), `${label} is in ⌘K, under Focus`);
  }
  assert.ok(!view('jobs').includes('id="tips-jobs"'), 'the Jobs tips ride on Focus');
});

test('Jobs keeps four tiles; the chips by the title open Review and the stuck jobs', () => {
  assert.deepEqual([...view('jobs').matchAll(/data-stat="(\w+)"/g)].map(m => m[1]), ['waiting', 'interviews', 'high', 'inbound']);
  assert.match(view('jobs'), /id="questions-chip"/);
  assert.match(view('jobs'), /<button[^>]*id="jobs-stuck"/);
});

test('the folded Find line says only what the search has told', () => {
  const log = ['⏳ Reading employer job sites: 1308 of 2251 · 73,152 jobs listed · about 3 min left'];
  assert.deepEqual(employersRead(log), {done: 1308, total: 2251, left: 'about 3 min'});
  assert.deepEqual(foldedParts({employers: employersRead(log), looked: 73152, scored: 4}), ['1,308 of 2,251 sites', '73,152 jobs listed', '4 on your list', 'about 3 min left']);
  assert.deepEqual(foldedParts({employers: null, looked: 0, scored: 0}), []);
});

test('the live dots and the cycling dots stand still under reduced motion', () => {
  assert.match(read('jobs-declutter.css'), /prefers-reduced-motion: reduce[\s\S]*find-dots[\s\S]*live-dot\.is-live \{ animation: none/);
});

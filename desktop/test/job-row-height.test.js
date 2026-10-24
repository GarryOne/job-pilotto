// Every job row is the same height (owner, 24 Oct 2026): one renderer draws them for every list, each of its lines is one line and always present.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));
const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const read = file => readFileSync(join(renderer, file), 'utf8');

test('only the shared row renderer draws a job row (a new list uses it, so it gets the fixed height)', () => {
  const drawers = walk(renderer).filter(f => f.endsWith('.js') && /el\('article', 'job-row/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(drawers.map(f => f.slice(renderer.length).replaceAll('\\', '/')), ['pages/jobs-render.js']);
});

test('the row always draws its reason and chip lines, and its place is one line', () => {
  const src = read('pages/jobs-render.js');
  assert.match(src, /role\.append\(Object\.assign\(el\('div', 'reason'/, 'the reason line is there even without a reason');
  assert.match(src, /\n\s*role\.append\(chips\);/, 'the chip line is there even without chips');
  assert.equal((src.match(/el\('div', 'place-line'\)/g) || []).length, 1, 'place and mode share one line');
  assert.match(src, /tag\(skill, \{title: skill\}\)/, 'a chip cut with … says its full text on hover');
});

test('the stylesheet keeps each line of a row to one line', () => {
  const css = read('style.css');
  for (const rule of [/\.job-row \.tags \{[^}]*flex-wrap: nowrap/, /\.job-row \.tags \.ui-tag \{[^}]*text-overflow: ellipsis/, /\.place-line span \{[^}]*white-space: nowrap/,
    /\.job-row \.reason \{[^}]*-webkit-line-clamp: 1/, /\.job-row \.title-line a[^{]*\{[^}]*text-overflow: ellipsis/]) assert.match(css, rule);
});

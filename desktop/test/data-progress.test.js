// The busy state on Settings → Move your data: every strip (export, import, backup, the reset's export) shows "Exporting… 42%" while its job runs, every
// button that starts a job is disabled meanwhile, and it all clears when the job ends.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
let listener;
globalThis.window.pilot = {onDataProgress: callback => { listener = callback; }, dataCancel: async () => true};
const {startProgress, progressText} = await import('../renderer/pages/data-progress.js');

const make = (tag, attrs = {}) => { const node = globalThis.document.createElement(tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) node.dataset[k.slice(5)] = v; body.append(node); return node; };
const strips = {export: [make('div', {'data-progress': 'export'}), make('div', {'data-progress': 'export'})], import: [make('div', {'data-progress': 'import'})], backup: [make('div', {'data-progress': 'backup'})]};
Object.values(strips).flat().forEach(strip => { strip.hidden = true; });
const starters = ['export-data', 'import-data', 'backup-now', 'reset-export'].map(id => make('button', {id}));
starters.push(make('button', {'data-import': '1'}));

test('the words: a percent once the total is known, never 100 before the end', () => {
  assert.equal(progressText({kind: 'export', done: 0, total: null}), 'Exporting…');
  assert.equal(progressText({kind: 'export', done: 42, total: 100}), 'Exporting… 42%');
  assert.equal(progressText({kind: 'import', done: 100, total: 100}), 'Importing… 99%');
  assert.equal(progressText({kind: 'backup', done: 1, total: 4}), 'Backing up… 25%');
});

test('a clear shows its words, has no Cancel and disables its own button', () => {
  const strip = make('div', {'data-progress': 'clear'}), button = make('button', {id: 'clear-jobs'});
  strip.hidden = true;
  startProgress();
  assert.equal(progressText({kind: 'clear', done: 0, total: null}), 'Clearing your job list…');
  assert.equal(strip.children[2].hidden, true, 'no Cancel on a clear');
  listener({kind: 'clear', state: 'running', done: 0, total: null});
  assert.equal(strip.hidden, false);
  assert.equal(button.disabled, true);
  listener({kind: 'clear', state: 'done'});
  assert.equal(strip.hidden, true);
  assert.equal(button.disabled, false);
});

test('busy → done: the matching strips show, the starters are disabled, then everything clears', () => {
  startProgress();
  listener({kind: 'export', state: 'running', done: 42, total: 100});
  for (const strip of strips.export) { assert.equal(strip.hidden, false); assert.match(strip.children[0].textContent || strip.children[0].children[0]?.data || '', /Exporting… 42%/); }
  for (const strip of [...strips.import, ...strips.backup]) assert.equal(strip.hidden, true, 'other kinds stay hidden');
  assert.ok(starters.every(button => button.disabled), 'every starter (export, import, backup, reset export, welcome import) is disabled');
  assert.ok(body.classList.contains('data-busy'));
  listener({kind: 'export', state: 'done'});
  assert.ok(Object.values(strips).flat().every(strip => strip.hidden));
  assert.ok(starters.every(button => !button.disabled));
  assert.ok(!body.classList.contains('data-busy'));
});

// The Find jobs card on top of Jobs: its five states, the running step, the counts. The page code (pages/jobs-find.js) only draws this.
import test from 'node:test';
import assert from 'node:assert/strict';
import {findCard, stepChips} from '../renderer/find-card-model.js';

const run = log => ({kind: 'search', log});

test('an empty first run offers the big button; a later visit shows nothing', () => {
  assert.equal(findCard({lastSearchAt: '', listed: 0}).state, 'empty');
  assert.equal(findCard({lastSearchAt: '2026-10-16T10:00:00Z', listed: 12}).state, 'none');
});

test('a running search shows its steps, last lines in words and the counts; the list grows below', () => {
  const log = ['Finding your first jobs…', 'First jobs: reading 15 of 212 employer sites first', 'First jobs: 9 found', 'Scored 1 of 3 job(s)'];
  const card = findCard({running: run(log), listed: 9, scored: 1});
  assert.equal(card.state, 'searching');
  assert.deepEqual(card.chips.map(c => c.state), ['active', 'pending', 'pending', 'pending']);
  assert.equal(card.chips[0].label, 'First jobs');
  assert.ok(card.lines.some(line => /9 jobs found in the first sites/.test(line)), card.lines.join('|'));
  assert.equal(card.listed, 9);
});

test('the steps move on: first jobs, then every employer, then the job boards, then more employers', () => {
  const at = line => stepChips(['Finding your first jobs…', line]).map(c => c.state).join(',');
  assert.equal(at('Searching job boards…'), 'done,done,active,pending');
  assert.equal(at('Growing your sources: finding more employers…'), 'done,done,done,active');
  assert.equal(stepChips(['Searching job boards…', 'Checking employer career pages…']).map(c => c.label).join('|'), 'Job boards|Employer sites|More employers');
});

test('a search that ended here is done, or failed with its reason; a failure on an empty list stays', () => {
  assert.equal(findCard({last: {ok: true, new: 4}, lastSearchAt: 'x', listed: 4, finishedHere: true}).state, 'done');
  const failed = findCard({last: {ok: false, problem: 'Claude Code is not answering'}, lastSearchAt: 'x', listed: 0});
  assert.deepEqual([failed.state, failed.problem], ['failed', 'Claude Code is not answering']);
  assert.equal(findCard({last: {ok: false}, lastSearchAt: 'x', listed: 30}).state, 'none', 'an old failure never covers a full list');
});

test('every state of the card is drawn by jobs-find.js and nothing else offers Refresh jobs', async () => {
  const fs = await import('node:fs');
  const draw = fs.readFileSync(new URL('../renderer/pages/jobs-find.js', import.meta.url), 'utf8');
  for (const state of ['empty', 'searching', 'done', 'failed']) assert.match(draw, new RegExp(`model.state === '${state}'`));
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.ok(!/<span>Refresh jobs<\/span>/.test(html));
});

// The class (owner, 16 Oct 2026: one action "Find jobs"): no screen, palette entry, run name, notification or message the app draws still names the two old
// actions. Comments may tell the history; strings may not. A new surface that copies the old words fails here.
test('no label the app shows still says Refresh jobs or Find new employers', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['node_modules', 'demo'].includes(entry.name)) walk(full); } else if (/\.(js|html)$/.test(entry.name)) files.push(full);
  } };
  walk(path.join(root, 'renderer')); walk(path.join(root, 'lib'));
  const hits = [];
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map(line => line.replace(/(^|\s)\/\/.*$/, '$1'));
    code.forEach((line, i) => { if (/Find new employers|Refresh jobs|Refreshing jobs/.test(line)) hits.push(`${path.relative(root, file)}:${i + 1}`); });
  }
  assert.deepEqual(hits, []);
});

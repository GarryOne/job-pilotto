// Interviews → ⋯ "Review again" (renderer/review-again.js): only on reviewed rows, with its cost in the label, busy
// while it runs, a message for every outcome; and it goes through the first review's IPC (demo mode writes nothing).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {BUSY, LABEL, START, againItem, doneMessage} from '../renderer/review-again.js';

test('a reviewed row gets "Review again" with its cost; a row not reviewed yet does not', () => {
  const run = () => 'ran';
  assert.equal(againItem({id: 'p', overall: ''}, false, run), null);
  const item = againItem({id: 'p', overall: 'neutral'}, false, run);
  assert.equal(item.label, 'Review again · updates the job (about $0.08)');
  assert.equal(item.label, LABEL);
  assert.equal(item.run(), 'ran');
  assert.match(item.title, /empty fields/);
});

test('while it runs the entry says so and a second press does nothing', () => {
  let ran = 0;
  const item = againItem({id: 'p', overall: 'positive'}, true, () => ran++);
  assert.equal(item.label, BUSY);
  item.run();
  assert.equal(ran, 0);
  assert.match(START, /again/);
});

test('every outcome has a message: done here, on GitHub, failed', () => {
  assert.deepEqual(doneMessage({ok: true, summary: 'Interview analysed again (Huxley, Recruiter screen, 6 questions, $0.052). Filled Salary (EUR 100-150k/year)'}),
    ['Interview analysed again (Huxley, Recruiter screen, 6 questions, $0.052). Filled Salary (EUR 100-150k/year). The review on the Notion page was replaced.', 'ok']);
  assert.equal(doneMessage({ok: true, cloud: true})[1], 'ok');
  assert.match(doneMessage({ok: true, cloud: true})[0], /GitHub/);
  const [text, tone] = doneMessage({ok: false, error: 'overloaded'});
  assert.equal(tone, 'error');
  assert.match(text, /overloaded.*not changed/);
  assert.equal(doneMessage(undefined)[1], 'error');
});

test('the page wires it into the row menu through the same review IPC; demo mode writes nothing', () => {
  const page = fs.readFileSync(new URL('../renderer/pages/interviews.js', import.meta.url), 'utf8');
  assert.match(page, /row\.overall \? \[\{again: true, run: \(\) => reviewAgainRow\(row\.id\)\}\]/);
  assert.match(page, /await iv\.review\(pageId\)\.catch/);
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /ipcMain\.handle\('ivReview', \(_, pageId\) => \(DEMO \? \{ok: true/);
  const demo = JSON.parse(fs.readFileSync(new URL('../demo/interviews.json', import.meta.url), 'utf8'));
  assert.ok(demo.saved.some(row => row.overall), 'demo data has a reviewed row, so the entry shows');
});

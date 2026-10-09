// Jobs → Board and saved views, the wiring: the IPC a drop uses, the demo guard, the hook in renderJobs, the ⌘K entries and the markup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a drop goes through the app\'s own stage paths (setStatus, setStage → the ledger event), demo-guarded', () => {
  const board = read('renderer/pages/jobs-board.js');
  assert.match(board, /window\.pilot\[move\.call\]\(job\.url, move\.arg\)/);
  assert.doesNotMatch(board, /stores|notion\./i, 'the board writes nothing itself');
  assert.match(read('preload.cjs'), /setStage: call\('setStage'\)/);
  assert.match(read('lib/demo.js'), /'setStage'/);
  const handler = read('lib/apply-handlers.js').match(/ipcMain\.handle\('setStage'[\s\S]*?\n {2}\}\);/)[0];
  assert.match(handler, /BOARD_STAGES\.includes\(to\)/, 'only outcome stages');
  assert.match(handler, /pipeline\.markOutcome\(storage, job, to\)/, 'the same engine step as How did it go?');
  assert.match(handler, /appLog\('outcome'/, 'logged');
});

test('renderJobs narrows by the saved view and ends by painting the chips and the board', () => {
  const render = read('renderer/pages/jobs-render.js');
  assert.match(render, /jobsState\.view \? shared\.allJobs\.filter\(job => inView\(job, jobsState\.view\)\)/);
  assert.match(render, /paintViews\(\(counted \|\| shared\.allJobs\)\.filter\(job => job\.stage && matches\(job, text\)\)\);\n\}/);
  assert.match(read('renderer/pages/jobs.js'), /if \(next\.stat\) jobsState\.view = null;/, 'a counter replaces a view');
});

test('the markup: chips above the list, the List | Board toggle, the board above the list and its panel', () => {
  const html = read('renderer/index.html');
  const at = id => html.indexOf(`id="${id}"`);
  for (const id of ['jobs-views', 'jobs-mode', 'jobs-board', 'jobs-split']) assert.ok(at(id) > 0, id);
  assert.ok(at('jobs-board') < at('jobs-split'), 'the board is not inside the list and job panel');
  assert.match(html, /data-mode="list"[^>]*>List<\/button><button data-mode="board"[^>]*>Board<\/button>/);
});

test('⌘K lists both modes and every saved view chip from the page', () => {
  const nav = read('renderer/pages/nav.js');
  assert.match(nav, /querySelectorAll\('\[data-mode\]'\)\.forEach/);
  assert.match(nav, /querySelectorAll\('#jobs-views \[data-view\]'\)\.forEach/);
});

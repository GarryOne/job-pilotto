// lib/log-view.js: Settings → Logs never sends a whole log to the window: one day at a time in pages of 100, and a
// search that sends at most 100 hits and stops reading older days once it has them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {tail, search, files, days, PAGE, MATCHES, MAX_SHOWN, LINE_CHARS} from '../lib/log-view.js';

const lines = (from, n = 50_000) => `${Array.from({length: n}, (_, i) => `2026-10-07T21:00:00.000Z [run] line ${from + i}${(from + i) % 1000 === 0 ? ' error' : ''}`).join('\n')}\n`;
// app-2026-10-06.log holds lines 0-49 999, today's app.log 50 000-99 999 (about 3 MB in all).
function folderWithLogs() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-logview-'));
  fs.writeFileSync(path.join(folder, 'app-2026-10-06.log'), lines(0));
  fs.writeFileSync(path.join(folder, 'app.log'), lines(50_000));
  return folder;
}

test('the days a log has, today first; today\'s newest 100 lines, oldest first', () => {
  const folder = folderWithLogs();
  assert.deepEqual(days(folder, 'app').map(d => d.day), ['today', '2026-10-06']);
  const {lines: shown, more} = tail(folder, 'app');
  assert.equal(shown.length, PAGE);
  assert.match(shown[0], /line 99900$/);
  assert.match(shown.at(-1), /line 99999$/);
  assert.equal(more, true);
  assert.match(tail(folder, 'app', {day: '2026-10-06'}).lines.at(-1), /line 49999$/);
});

test('"Show more" stays in the day and stops at MAX_SHOWN', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-logview-'));
  fs.writeFileSync(path.join(folder, 'app-2026-10-06.log'), 'old 1\nold 2\n');
  fs.writeFileSync(path.join(folder, 'app.log'), 'new 1\nnew 2\nnew 3\n');
  assert.deepEqual(tail(folder, 'app', {count: 2}).lines, ['new 2', 'new 3']);
  assert.deepEqual(tail(folder, 'app', {skip: 2}), {lines: ['new 1'], more: false});
  assert.equal(tail(folderWithLogs(), 'app', {skip: MAX_SHOWN - PAGE}).more, false);
});

test('search: any case, newest 100 hits, and it stops before reading older days once it has them', async () => {
  const folder = folderWithLogs();
  const errors = await search(folder, 'app', 'ERROR');   // 50 in today's file, 50 the day before
  assert.equal(errors.lines.length, MATCHES);
  assert.equal(errors.more, false);
  assert.match(errors.lines[0], /line 0 error$/);
  assert.match(errors.lines.at(-1), /line 99000 error$/);
  const many = await search(folder, 'app', '[run]');
  assert.deepEqual([many.lines.length, many.more], [MATCHES, true]);
  assert.match(many.lines[0], /line 99900$/);   // all from today: the day before was never needed
  assert.equal((await search(folder, 'app', 'error', {day: 'today'})).lines.length, 50);
  assert.deepEqual(await search(folder, 'app', '  '), {lines: [], more: false});
});

test('notion rotates by size; long lines are cut; unknown names and bad days read as empty', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-logview-'));
  fs.writeFileSync(path.join(folder, 'notion-requests.log.1'), 'older\n');
  fs.writeFileSync(path.join(folder, 'notion-requests.log'), 'newer\n');
  assert.deepEqual(tail(folder, 'notion').lines, ['older', 'newer']);
  assert.deepEqual(days(folder, 'notion').map(d => d.day), ['today']);
  fs.writeFileSync(path.join(folder, 'engine.log'), `${'x'.repeat(5000)}\n`);
  assert.ok(tail(folder, 'engine').lines[0].length < LINE_CHARS + 30);
  assert.deepEqual(files(folder, 'app', '../../etc/passwd'), []);
  assert.deepEqual(files(folder, 'nope'), []);
  assert.deepEqual(await search(folder, 'nope', 'x'), {lines: [], more: false});
});

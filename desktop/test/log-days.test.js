// lib/log-days.js: one log file per day, today's under the plain name, 30 days kept, a total cap, a day cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {rollDay, dayFiles, prune, capDay, localDay, forgetSeen} from '../lib/log-days.js';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-days-'));
const written = (file, text, at) => { fs.writeFileSync(file, text); fs.utimesSync(file, at, at); };

test('the first write of a new day moves yesterday to app-<day>.log; the same day leaves it', () => {
  forgetSeen();
  const dir = folder(), file = path.join(dir, 'app.log');
  written(file, 'monday\n', new Date(2026, 9, 5, 23, 50));
  assert.equal(rollDay(file, {now: new Date(2026, 9, 5, 23, 59)}), false);
  forgetSeen();
  assert.equal(rollDay(file, {now: new Date(2026, 9, 6, 0, 1)}), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(path.join(dir, 'app-2026-10-05.log'), 'utf8'), 'monday\n');
});

test('a day file that already exists gets the lines appended, never overwritten', () => {
  forgetSeen();
  const dir = folder(), file = path.join(dir, 'engine.log');
  fs.writeFileSync(path.join(dir, 'engine-2026-10-05.log'), 'first\n');
  written(file, 'second\n', new Date(2026, 9, 5, 12));
  rollDay(file, {now: new Date(2026, 9, 6, 9)});
  assert.equal(fs.readFileSync(path.join(dir, 'engine-2026-10-05.log'), 'utf8'), 'first\nsecond\n');
});

test('days older than 30 go, the oldest past the total cap, and the old .1 files; other logs are left alone', () => {
  const dir = folder(), file = path.join(dir, 'app.log');
  fs.writeFileSync(file, 'x'.repeat(10));
  for (const day of ['2026-09-06', '2026-09-08', '2026-10-01', '2026-10-06']) fs.writeFileSync(path.join(dir, `app-${day}.log`), 'x'.repeat(10));
  fs.writeFileSync(path.join(dir, 'engine-2026-08-01.log'), 'other log');
  fs.writeFileSync(path.join(dir, 'app.log.1'), 'legacy');
  prune(file, {now: new Date(2026, 9, 7, 12)});
  assert.deepEqual(dayFiles(file).map(d => d.day), ['2026-10-06', '2026-10-01', '2026-09-08']);
  prune(file, {now: new Date(2026, 9, 7, 12), maxTotal: 25});
  assert.deepEqual(dayFiles(file).map(d => d.day), ['2026-10-06']);
  assert.ok(fs.existsSync(path.join(dir, 'engine-2026-08-01.log')));
  assert.equal(fs.existsSync(path.join(dir, 'app.log.1')), false);   // the old size-rotated format is gone
  assert.ok(fs.existsSync(file));
});

test('a day past its cap keeps its newest part, from a line start', () => {
  const file = path.join(folder(), 'app.log');
  fs.writeFileSync(file, Array.from({length: 100}, (_, i) => `line ${i}`).join('\n') + '\n');
  assert.equal(capDay(file, 200, 100), true);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.at(-1), 'line 99');
  assert.match(lines[0], /^line \d+$/);
  assert.equal(capDay(file, 10_000), false);
  assert.equal(localDay(new Date(2026, 0, 2)), '2026-01-02');
});

// notion-requests.log has a second writer (the Python jobs, one open-append-close per line): a line it writes while the
// app caps or rolls the file must not be lost. Simulated by appending in the middle of the cap.
test('a line another process appends while the file is capped or rolled is kept', () => {
  const dir = folder(), file = path.join(dir, 'notion-requests.log');
  fs.writeFileSync(file, Array.from({length: 100}, (_, i) => `line ${i}`).join('\n') + '\n');
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { rename(from, to); fs.appendFileSync(file, 'python line\n'); };   // Python writes right after the move
  try { assert.equal(capDay(file, 200, 100), true); } finally { fs.renameSync = rename; }
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines[0], 'python line');
  assert.equal(lines.at(-1), 'line 99');
  assert.deepEqual(fs.readdirSync(dir), ['notion-requests.log']);   // nothing left aside

  forgetSeen();
  fs.writeFileSync(path.join(dir, 'notion-requests-2026-10-05.log'), 'earlier\n');
  written(file, 'later\n', new Date(2026, 9, 5, 12));
  fs.renameSync = (from, to) => { rename(from, to); fs.appendFileSync(file, 'python line\n'); };
  try { rollDay(file, {now: new Date(2026, 9, 6, 9)}); } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(path.join(dir, 'notion-requests-2026-10-05.log'), 'utf8'), 'earlier\nlater\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'python line\n');
});

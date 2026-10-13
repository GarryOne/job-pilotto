// lib/log.js keeps each app.log line short: a run's output tail (116 KB of job JSON) once filled the 1 MB log in a minute.
import test from 'node:test';
import assert from 'node:assert/strict';
import {format, FIELD_MAX, LINE_MAX, FIELDS_LINE_MAX} from '../lib/log.js';

const at = new Date('2026-10-07T21:12:16.620Z');
const fields = line => JSON.parse(line.slice(line.indexOf(' {') + 1));

test('a long field is cut, with how much was left out', () => {
  const data = fields(format('run', 'end: python -m src.desktop jobs', {run_id: 'abc', tail: ['x'.repeat(116_000), 'short']}, at));
  assert.equal(data.tail[0], `${'x'.repeat(FIELD_MAX)}… (+${116_000 - FIELD_MAX} chars)`);
  assert.equal(data.tail[1], 'short');
  assert.equal(data.run_id, 'abc');
});

test('nested objects, numbers and flags keep their shape', () => {
  const data = fields(format('ui', 'x', {n: 3, ok: true, deep: {list: ['y'.repeat(400)]}, none: null}, at));
  assert.equal(data.n, 3);
  assert.equal(data.ok, true);
  assert.equal(data.none, null);
  assert.ok(data.deep.list[0].startsWith('y'.repeat(FIELD_MAX)) && data.deep.list[0].length < 400);
});

test('a line never passes LINE_MAX, whatever its fields', () => {
  const many = Object.fromEntries(Array.from({length: 100}, (_, i) => [`k${i}`, 'z'.repeat(FIELD_MAX)]));
  assert.ok(format('run', 'many', many, at).length <= LINE_MAX + 40);
  assert.equal(format('run', 'plain', undefined, at), '2026-10-07T21:12:16.620Z [run] plain');
});

test('the fill\'s fields line (both wordings) keeps its 40 rows whole; any other line stays at LINE_MAX', () => {
  const rows = Array.from({length: 40}, (_, i) => ({label: `Question number ${i} `.padEnd(50, 'x'), type: 'combobox', outcome: 'left', source: 'Claude (on the page)', reason: 'dropdown clicked, but it selected another choice (0.4 s)'.padEnd(80, '.'), required: true}));
  for (const message of ['fill: fields: 0 filled, 40 left', 'fill: fields (updated after a late retype): 0 filled, 40 left']) {
    const line = format('extension', message, {url: 'https://jobs.example.com/apply', fields: rows}, at);
    assert.ok(line.length > LINE_MAX && line.length <= FIELDS_LINE_MAX + 40, `${message}: ${line.length}`);
    assert.equal(JSON.parse(line.slice(line.indexOf('{"url"'))).fields.length, 40);
  }
  assert.ok(format('extension', 'fill: a menu showed no choice', {fields: rows}, at).length <= LINE_MAX + 40);
});

// electron-log's own file transport (its Node build: the same code as in the app) writes our lines as they are;
// a day past DAY_MAX keeps its newest half.
test('through electron-log: the lines unchanged, a full day cropped to its newest part', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const {default: electronLog} = await import('electron-log/node.js');
  const {logTo, log, logFile} = await import('../lib/log.js');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-log-'));
  const logger = electronLog.create({logId: 'jp-test'});
  logTo(folder, logger);
  logger.transports.file.maxSize = 2000;   // a small cap so a few lines pass it
  for (let i = 0; i < 300; i += 1) log('run', `line ${i}`, {n: i});
  assert.deepEqual(fs.readdirSync(folder), ['app.log']);
  const text = fs.readFileSync(logFile(), 'utf8');
  assert.ok(text.length < 4000);
  assert.match(text.trim().split('\n').pop(), /^\d{4}-\d\d-\d\dT[\d:.]+Z \[run\] line 299 \{"n":299\}$/);
  logTo(folder);   // back to the plain writer for the other tests
});

// The shape report of an "other" outcome (lib/ladder/other.js): a page the ladder could not read is counted per page shape (fixed values, no text) and logged as `ladder: other shape=<key>`.
// Through the real endpoint (lib/server-pages.js decidePageKind); the counts are what the pack reporter will send (lib/recipes.js, wired by the learning owner).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {decidePageKind} from '../lib/server-pages.js';
import {logFile, logTo} from '../lib/log.js';
import {counts, otherStore, record} from '../lib/ladder/other.js';

const newStorage = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ladder-other-')); return {dir, path: name => path.join(dir, name), settings: () => ({}), readText: () => '', writeText() {}, saveSettings() {}}; };
const page = n => ({url: `https://jobs.other.test/careers/${n}000?token=secret`, controls: [{type: 'text', label: 'x'}], title: 'T', headings: [], buttons: []});

test('a request with why: other counts the page shape, logs one line with the shape and no text, and asks no AI', async () => {
  const storage = newStorage(); logTo(storage.dir);
  const reply = await decidePageKind(storage, {...page(1), why: 'other', needs: 'Send your CV to anna@firma.ch', title: 'Call 044 555 01 00'}, {client: null});
  assert.deepEqual([reply.ok, reply.reported], [true, true]);
  await decidePageKind(storage, {...page(2), why: 'other'}, {client: null});   // another posting of the same shape
  const rows = counts(otherStore(storage.path('ladder-other.json')));
  assert.equal(rows.length, 1); assert.equal(rows[0].n, 2);
  assert.match(rows[0].shape, /^jobs\.other\.test\/careers\/[^|]*\|[a-z0-9-]+$/);
  const log = fs.readFileSync(logFile(), 'utf8').split('\n').filter(line => line.includes('ladder: other shape='));
  assert.equal(log.length, 2); assert.ok(log[0].includes(`shape=${rows[0].shape}`));
  const everything = log.join('\n') + fs.readFileSync(storage.path('ladder-other.json'), 'utf8');
  for (const leak of ['anna@', 'firma', '044', 'secret', 'token']) assert.ok(!everything.includes(leak), `${leak} leaked`);
});

test('only a real page shape is counted: no address, no odd value, a bounded list', () => {
  const store = otherStore(path.join(newStorage().dir, 'o.json'));
  for (const bad of ['', 'not a shape', 'a@b.example|1', 'x'.repeat(200) + '|1', undefined]) assert.equal(record(store, bad), false, String(bad));
  assert.equal(record(store, 'jobs.a.test/careers/*|3-7'), true);
  for (let i = 0; i < 700; i++) record(store, `jobs.a.test/p${i}|1`);
  assert.ok(counts(store).length <= 500);
  assert.ok(counts(store).every(row => Number.isInteger(row.n) && Object.keys(row).sort().join() === 'n,shape'));
});

test('the counts survive a restart; a corrupt file is an empty store', () => {
  const file = path.join(newStorage().dir, 'o.json');
  const first = otherStore(file); record(first, 'jobs.a.test/careers/*|3-7'); record(first, 'jobs.a.test/careers/*|3-7');
  assert.deepEqual(counts(otherStore(file)), [{shape: 'jobs.a.test/careers/*|3-7', n: 2}]);
  fs.writeFileSync(file, '{not json'); assert.deepEqual(counts(otherStore(file)), []);
});

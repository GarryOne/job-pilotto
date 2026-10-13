// The control repairs' feed to the site (lib/ladder/repair-feed.js, PR D2): the counts since the last successful send, fixed values only; the reporter (lib/recipes.js) sends them as `repairs`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {noteRepair, repairStore} from '../lib/ladder/repair-kept.js';
import {REPAIRS_SENT, repairDelta} from '../lib/ladder/repair-feed.js';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-repair-feed-'));
const storageOf = dir => ({path: name => path.join(dir, name), readText: name => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return ''; } }});
const note = (dir, row) => { const store = repairStore(path.join(dir, 'fill-repairs.json')); noteRepair(store, row); store.save(); };

test('the first feed sends every tally; the next only what changed since the totals were written', () => {
  const dir = folder(), storage = storageOf(dir);
  assert.deepEqual(repairDelta(storage).rows, [], 'nothing tallied, nothing sent');
  note(dir, {fp: 'abc123', verb: 'retype', widget: 'text', ok: true});
  note(dir, {fp: 'abc123', verb: 'retype', widget: 'text', ok: true});
  note(dir, {fp: 'menu42x', verb: 'choose_option', widget: 'native_select', option: 0, ok: false});
  const first = repairDelta(storage);
  assert.deepEqual(first.rows.map(row => [row.fp, row.verb, row.ok, row.failed]), [['abc123', 'retype', 2, 0], ['menu42x', 'choose_option', 0, 1]]);
  fs.mkdirSync(path.join(dir, 'data'), {recursive: true});
  fs.writeFileSync(path.join(dir, REPAIRS_SENT), JSON.stringify(first.totals));
  assert.deepEqual(repairDelta(storage).rows, [], 'the site has them all');
  note(dir, {fp: 'abc123', verb: 'retype', widget: 'text', ok: false});
  assert.deepEqual(repairDelta(storage).rows.map(row => [row.fp, row.ok, row.failed]), [['abc123', 0, 1]]);
});

test('only fixed values travel: a fingerprint, a verb, two integers', () => {
  const dir = folder();
  note(dir, {fp: 'box1234', verb: 'retype', widget: 'text', ok: true, label: 'secret', value: 'secret'});
  const sent = JSON.stringify(repairDelta(storageOf(dir)).rows);
  assert.ok(!sent.includes('secret'));
  assert.deepEqual(Object.keys(JSON.parse(sent)[0]).sort(), ['failed', 'fp', 'ok', 'verb']);
});

test('a storage with no folder (a unit test\'s fake) sends nothing', () => {
  assert.deepEqual(repairDelta({}), {rows: [], totals: {}});
});

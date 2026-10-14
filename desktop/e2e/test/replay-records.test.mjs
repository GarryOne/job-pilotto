// The CI replay's bookkeeping (replay-records.mjs): the newest record per pool row, its "Replay vs live" record, and "N of M same as live". Pure: no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {deferredRows, fidelityRecord, newestPerRow, sameAsLive, whereOf} from '../replay-records.mjs';

test('each pool row replays its newest record; a record without a name goes by its posting host', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-records-'));
  const put = (dir, record) => { fs.mkdirSync(path.join(root, dir), {recursive: true}); fs.writeFileSync(path.join(root, dir, 'record.json'), JSON.stringify(record)); };
  put('run1/a', {name: 'Row A', url: 'https://a.test/job', startMs: 1});
  put('run2/a', {name: 'Row A', url: 'https://a.test/job', startMs: 5});
  put('run2/b', {url: 'https://www.b.test/job', startMs: 3});
  const rows = newestPerRow(root);
  assert.deepEqual(rows.map(row => [row.name, row.record.startMs]), [['Row A', 5], ['www.b.test', 3]]);
});

test('a row is the same as live only with every live ask answered, no extra ask and no site request missing; a third party miss does not count', () => {
  const row = {name: 'Row A', record: {url: 'https://www.a.test/job'}};
  const same = fidelityRecord(row, {liveAsks: 4, liveHit: 4, misses: 0, counts: {order: 2, notRecorded: ['GET https://tracker.other.test/x (script)']}});
  const off = fidelityRecord(row, {liveAsks: 4, liveHit: 3, misses: 1, counts: {notRecorded: ['GET https://jobs.a.test/api (fetch)']}});
  assert.equal(same.network.notRecorded, 0);
  assert.equal(off.network.notRecorded, 1);
  assert.equal(fidelityRecord(row, null).network, null, 'a replay with no result is reported, never counted as a pass');
  assert.deepEqual(fidelityRecord(row, {liveAsks: 4, liveHit: 1, misses: 3, firstMiss: {differs: ['output'], volatile: []}}).firstMiss, {differs: ['output']}, 'the first miss\'s differing parts go to the gate (names only)');
  assert.equal(fidelityRecord(row, {liveAsks: 4, liveHit: 4}).firstMiss, null);
  assert.equal(sameAsLive([same, off, fidelityRecord(row, null)]), 1);
});

test('a record says where it was made (its own word, else the Mac release folder) and when; an unnamed record finds its pool row by address; a deferred row carries its reason', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-records-'));
  fs.mkdirSync(path.join(root, 'mac', 'x'), {recursive: true});
  fs.writeFileSync(path.join(root, 'mac', 'x', 'record.json'), JSON.stringify({url: 'https://jobs.a.test/job?id=1#jobpilotto-fill=ab', startMs: Date.parse('2026-10-13T22:00:00Z')}));
  const [row] = newestPerRow(root, new Map([['https://jobs.a.test/job?id=1', 'Row A (found 2026-10-10)']]));
  assert.equal(row.name, 'Row A (found 2026-10-10)');
  const record = fidelityRecord(row, {liveAsks: 2, liveHit: 2, misses: 0, counts: {}}, {deferred: {'Row A (found 2026-10-10)': 'replay lags'}});
  assert.deepEqual(record.recording, {where: 'mac', at: '2026-10-13T22:00:00.000Z'});
  assert.equal(record.deferred, 'replay lags');
  assert.equal(whereOf({where: 'ci'}, '/x/mac/y'), 'ci', 'the record\'s own word wins');
  assert.equal(whereOf({}, '/records/38473536545/a'), 'ci');
});

test('every deferred row names a real pool row', () => {
  const shapes = new Set(JSON.parse(fs.readFileSync(new URL('../smoke-sites.json', import.meta.url), 'utf8')).shapes.map(site => site.shape));
  for (const name of Object.keys(deferredRows())) assert.ok(shapes.has(name), `replay-deferred.json: "${name}" is not a pool row`);
});

test('a shard "k/n" takes every n-th row from the k-th; no or a bad spec takes all (the scheduled replay\'s 5 runners)', async () => {
  const {shardOf} = await import('../replay-records.mjs');
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(shardOf(rows, '0/5'), ['a', 'f']);
  assert.deepEqual(shardOf(rows, '4/5'), ['e']);
  assert.deepEqual([0, 1, 2, 3, 4].flatMap(k => shardOf(rows, `${k}/5`)).sort(), rows, 'every row once');
  for (const spec of ['', '5/5', 'x', '1/0']) assert.deepEqual(shardOf(rows, spec), rows);
});

test('the CLI prints one line per row as it starts and ends, so a CI step is never silent for minutes', async () => {
  const {spawnSync} = await import('node:child_process');
  const os = await import('node:os');
  const fsm = await import('node:fs');
  const pathm = await import('node:path');
  const root = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'replay-records-'));
  fsm.mkdirSync(pathm.join(root, 'records', 'row-a'), {recursive: true});
  fsm.writeFileSync(pathm.join(root, 'records', 'row-a', 'record.json'), JSON.stringify({name: 'Row A', url: 'https://jobs.example.com/a', startMs: 1}));
  const ran = spawnSync(process.execPath, [new URL('../replay-records.mjs', import.meta.url).pathname, pathm.join(root, 'records'), pathm.join(root, 'out')], {encoding: 'utf8', timeout: 60000});
  assert.match(ran.stderr, /replay-records: \[1\/1\] Row A: replaying/);
  assert.match(ran.stderr, /replay-records: \[1\/1\] Row A: no result \(\d+ s\)/);
  fsm.rmSync(root, {recursive: true, force: true});
});

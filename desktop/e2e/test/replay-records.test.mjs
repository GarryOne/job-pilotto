// The CI replay's bookkeeping (replay-records.mjs): the newest record per pool row, its "Replay vs live" record, and "N of M same as live". Pure: no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fidelityRecord, newestPerRow, sameAsLive} from '../replay-records.mjs';

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
  assert.equal(sameAsLive([same, off, fidelityRecord(row, null)]), 1);
});

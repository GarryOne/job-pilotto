// desktop/e2e/fidelity-report.mjs: reads a step-4 folder, sends ONE PUT with the key from the environment, never prints the key, says why when it does not send.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {readRecords, uploadFidelity} from '../fidelity-report.mjs';

test('reads one record per file and a {rows} file; ignores other files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-'));
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({name: 'a'}));
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({rows: [{name: 'b'}, {name: 'c'}]}));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  assert.deepEqual(readRecords(dir).map(row => row.name), ['a', 'b', 'c']);
});

test('one PUT with the Bearer key; no key, no records or a dry run send nothing; the key is never in the line', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({url, init}); return {ok: true, json: async () => ({stored: 2})}; };
  const line = await uploadFidelity([{name: 'a'}, {name: 'b'}], {env: {REPLAYS_PUBLISH_KEY: 'secret-key'}, fetcher});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-key');
  assert.match(line, /2 record\(s\) stored/);
  assert.ok(!line.includes('secret-key'));
  assert.match(await uploadFidelity([{name: 'a'}], {env: {}, fetcher}), /not in the environment/);
  assert.match(await uploadFidelity([], {env: {REPLAYS_PUBLISH_KEY: 'k'}, fetcher}), /no records/);
  assert.match(await uploadFidelity([{name: 'a'}], {env: {REPLAYS_PUBLISH_KEY: 'k'}, fetcher, dry: true}), /dry run/);
  assert.equal(calls.length, 1);
});

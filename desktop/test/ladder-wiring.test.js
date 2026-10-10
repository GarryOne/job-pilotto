// The ladder's write-back through the real endpoint (lib/server-pages.js decidePageKind -> page-kind.js pageKind): a verified rung 3/4 answer becomes the kept answer, one contradiction drops it,
// an email outcome is never reused, and the learned counts go out as deltas with the shared counts (lib/recipes.js). Guard for lib/ladder/learning.js's wiring.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {decidePageKind} from '../lib/server-pages.js';
import {createReporter} from '../lib/recipes.js';

const newStorage = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ladder-wire-'));
  const files = {};
  return {dir, path: name => path.join(dir, name), settings: () => ({}), readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }, saveSettings() {}};
};
const page = n => ({url: `https://jobs.wire.test/careers/${n}000`, controls: [{type: 'text', label: 'x'}], title: 'T', headings: [], buttons: []});
const verified = (n, extra = {}) => ({...page(n), verified: true, rung: 3, outcome: 'form', kind: 'posting', signal: 'confident', ...extra});
const noAi = {client: null};   // the real pageKind, no AI: only a kept or learned answer can answer

test('a verified rung 3 answer is the next visit\'s answer (rung 1, by learned), with no AI', async () => {
  const storage = newStorage();
  assert.equal((await decidePageKind(storage, page(1), noAi)).kind, '', 'nothing known first');
  const saved = await decidePageKind(storage, verified(1), noAi);
  assert.equal(saved.ok, true);
  const again = await decidePageKind(storage, page(2), noAi);   // another posting of the shape
  assert.equal(again.kind, 'posting');
  assert.equal(again.by, 'learned'); assert.equal(again.rung, 1); assert.equal(again.signal, 'confident');
});

test('an unverified or odd body keeps nothing', async () => {
  const storage = newStorage();
  for (const extra of [{verified: false}, {verified: 'true'}, {rung: 2}, {kind: 'The page says send your CV to a@b.example'}, {outcome: 'sure'}, {signal: 'maybe'}]) await decidePageKind(storage, verified(1, extra), noAi);
  assert.equal((await decidePageKind(storage, page(3), noAi)).kind, '');
  assert.ok(!fs.existsSync(storage.path('ladder-learning.json')) || !fs.readFileSync(storage.path('ladder-learning.json'), 'utf8').includes('CV'));
});

test('an email outcome is never a kept answer: the shape is asked again', async () => {
  const storage = newStorage();
  await decidePageKind(storage, verified(1, {outcome: 'email'}), noAi);
  const reply = await decidePageKind(storage, page(2), noAi);
  assert.equal(reply.kind, '');
  assert.ok(!fs.readFileSync(storage.path('ladder-learning.json'), 'utf8').includes('@'));
});

test('a learned answer never survives a contradiction (forget, or the contradicted signal)', async () => {
  for (const contradiction of [{forget: true}, {signal: 'contradicted'}]) {
    const storage = newStorage();
    await decidePageKind(storage, verified(1), noAi);
    assert.equal((await decidePageKind(storage, page(2), noAi)).by, 'learned');
    await decidePageKind(storage, {...page(2), ...contradiction}, noAi);
    assert.equal((await decidePageKind(storage, page(3), noAi)).kind, '', JSON.stringify(contradiction));
  }
});

test('a fresh page, and a digest request, do not use the learned answer; another shape is untouched', async () => {
  const storage = newStorage();
  await decidePageKind(storage, verified(1), noAi);
  assert.equal((await decidePageKind(storage, {...page(2), fresh: true}, noAi)).kind, '');
  assert.notEqual((await decidePageKind(storage, {...page(2), digest: true}, noAi)).by, 'learned');
  assert.equal((await decidePageKind(storage, {url: 'https://other.wire.test/jobs/1', controls: [{type: 'text', label: 'x'}]}, noAi)).kind, '');
});

test('a confirmed learned answer counts a hit; counts leave as deltas with the shared counts, fixed values only', async () => {
  const storage = newStorage();
  await decidePageKind(storage, verified(1), noAi);
  await decidePageKind(storage, {...page(2), confirmed: true}, noAi);
  const sent = [];
  const reporter = createReporter(storage, {fetcher: async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true}; }, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.flow('jobs.wire.test', 'filled');   // something to send
  await reporter.flush?.();
  const body = sent[0];
  assert.deepEqual(body.ladder, [{shape: 'jobs.wire.test/careers/*|1-2', rung: 3, outcome: 'form', hits: 1, misses: 0}]);
});

test('only what changed since the last successful send is sent again; a failed send is sent again', async () => {
  const storage = newStorage();
  await decidePageKind(storage, verified(1), noAi);
  let ok = false; const sent = [];
  const reporter = createReporter(storage, {fetcher: async (url, init) => { sent.push(JSON.parse(init.body)); return {ok}; }, base: 'https://site.test', setTimer: () => ({unref() {}})});
  await reporter.flush();   // fails: nothing is marked as sent
  ok = true;
  await reporter.flush();
  assert.equal(sent.at(-1).ladder.length, 1);
  const before = sent.length;
  await reporter.flush();   // nothing changed: no request
  assert.equal(sent.length, before);
  await decidePageKind(storage, {...page(2), confirmed: true}, noAi);
  await reporter.flush();
  assert.deepEqual(sent.at(-1).ladder.map(row => [row.hits, row.misses]), [[1, 0]]);
  await decidePageKind(storage, {...page(2), forget: true}, noAi);
  await reporter.flush();
  assert.deepEqual(sent.at(-1).ladder.map(row => [row.hits, row.misses]), [[0, 1]]);
});

test('the "other" shape counts leave as deltas too (ladderOther: [{shape, n}]), a failed send is sent again', async () => {
  const {otherStore, record} = await import('../lib/ladder/other.js');
  const storage = newStorage(), store = otherStore(storage.path('ladder-other.json'));
  const shape = 'jobs.wire.test/careers/*|1-2';
  record(store, shape); record(store, shape);
  let ok = false; const sent = [];
  const reporter = createReporter(storage, {fetcher: async (url, init) => { sent.push(JSON.parse(init.body)); return {ok}; }, base: 'https://site.test', setTimer: () => ({unref() {}})});
  await reporter.flush();   // fails: not marked as sent
  ok = true;
  await reporter.flush();
  assert.deepEqual(sent.at(-1).ladderOther, [{shape, n: 2}]);
  const before = sent.length;
  await reporter.flush();
  assert.equal(sent.length, before, 'nothing new: no request');
  record(otherStore(storage.path('ladder-other.json')), shape);
  await reporter.flush();
  assert.deepEqual(sent.at(-1).ladderOther, [{shape, n: 1}]);
  assert.ok(!JSON.stringify(sent).includes('@'), 'fixed values only');
});

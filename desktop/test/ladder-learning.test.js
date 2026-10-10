// Write-back of the ladder (lib/ladder/learning.js): only a verified decision of rung 3+ is kept for a page shape, one miss drops it, counts carry fixed values only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {capsFor, counts, hit, ladderStore, lookup, miss, record} from '../lib/ladder/learning.js';
import {CAPS} from '../lib/ladder/rung4-picture.js';

const fileIn = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ladder-')), 'ladder-learning.json');
const storeIn = () => { const file = fileIn(); return {file, store: ladderStore(file)}; };
const SHAPE = 'jobs.example.ch/careers/*|3-7';
const good = {rung: 3, outcome: 'form', kind: 'posting', signal: 'confident', verified: true};

test('an unverified decision is never kept', () => {
  const {store} = storeIn();
  assert.equal(record(store, SHAPE, {...good, verified: false}), false);
  assert.equal(record(store, SHAPE, {...good, verified: 'yes'}), false);   // a boolean true only
  assert.equal(lookup(store, SHAPE), null);
  assert.deepEqual(counts(store), []);
});

test('only rung 3 or higher is kept', () => {
  const {store} = storeIn();
  for (const rung of [0, 1, 2, 7, 3.5, '3']) assert.equal(record(store, SHAPE, {...good, rung}), false, `rung ${rung}`);
  assert.equal(lookup(store, SHAPE), null);
  for (const rung of [3, 4, 5]) assert.equal(record(storeIn().store, SHAPE, {...good, rung}), true);
});

test('a verified decision is kept for its shape, with who decided, hits and an hour', () => {
  const {store} = storeIn();
  assert.equal(record(store, SHAPE, good, {now: Date.UTC(2026, 9, 10)}), true);
  assert.deepEqual(lookup(store, SHAPE), {by: 3, outcome: 'form', kind: 'posting', signal: 'confident', hits: 0, misses: 0, at: '2026-10-10T00:00:00.000Z'});
  assert.equal(hit(store, SHAPE), true);
  assert.equal(hit(store, SHAPE), true);
  assert.equal(lookup(store, SHAPE).hits, 2);
  assert.equal(hit(store, 'other.example/x|0'), false);   // nothing kept: nothing counted
});

test('one miss drops the kept answer; the count of the miss stays', () => {
  const {store} = storeIn();
  record(store, SHAPE, good); hit(store, SHAPE);
  assert.equal(miss(store, SHAPE), true);
  assert.equal(lookup(store, SHAPE), null);
  assert.equal(miss(store, SHAPE), false);   // nothing kept any more
  assert.deepEqual(counts(store), [{shape: SHAPE, rung: 3, outcome: 'form', hits: 1, misses: 1}]);
  record(store, SHAPE, good);   // learned again after the miss
  assert.equal(lookup(store, SHAPE).misses, 1);
});

test('a kept answer survives a restart', () => {
  const {file, store} = storeIn();
  record(store, SHAPE, good);
  assert.equal(lookup(ladderStore(file), SHAPE).by, 3);
});

test('no text is ever stored: hostile fields never reach the file', () => {
  const {file, store} = storeIn();
  const sentence = 'Please send your CV to jane.doe@secret-employer.example before Friday';
  const hostile = {...good, outcome: 'email', text: sentence, address: 'jane.doe@secret-employer.example', url: 'https://x.example/a?token=abc123', chosen: [{text: sentence}], digest: {chosen: [{text: sentence}]}, by: sentence, hits: sentence};
  record(store, SHAPE, hostile);
  record(store, 'https://jobs.example.ch/a?token=abc123', good);   // a url with a query is not a shape
  record(store, `jobs.example.ch/${sentence}`, good);
  record(store, 'jane.doe@secret-employer.example', good);
  assert.equal(record(store, 'jobs.x.ch/y|0', {...good, outcome: sentence, kind: sentence}), false);   // outside the fixed values: nothing is kept
  const raw = fs.readFileSync(file, 'utf8');
  for (const needle of ['jane', 'secret-employer', 'Friday', 'token', 'abc123', 'CV', 'send']) assert.ok(!raw.includes(needle), `${needle} leaked`);
  assert.deepEqual(Object.keys(JSON.parse(raw).kept), [SHAPE]);
});

test('an email outcome keeps its class (ask again with the digest), never the address', () => {
  const {file, store} = storeIn();
  record(store, SHAPE, {...good, outcome: 'email', applyEmail: 'jobs@employer.example', chosen: [{kind: 'email', text: 'jobs@employer.example'}]});
  const kept = lookup(store, SHAPE);
  assert.equal(kept.outcome, 'email');
  assert.equal(kept.askAgain, true);   // a hint that this shape asks for addresses, not an answer to reuse
  assert.ok(!fs.readFileSync(file, 'utf8').includes('employer.example'));
  assert.equal(lookup(storeIn().store, SHAPE), null);
  const plain = storeIn().store; record(plain, SHAPE, good);
  assert.equal(lookup(plain, SHAPE).askAgain, undefined);
});

test('counts are fixed values and numbers only', () => {
  const {store} = storeIn();
  record(store, SHAPE, good); hit(store, SHAPE);
  record(store, 'jobs.other.ch/apply|0', {...good, rung: 4, outcome: 'expired'});
  const list = counts(store);
  assert.deepEqual(list, [{shape: 'jobs.example.ch/careers/*|3-7', rung: 3, outcome: 'form', hits: 1, misses: 0}, {shape: 'jobs.other.ch/apply|0', rung: 4, outcome: 'expired', hits: 0, misses: 0}]);
  for (const row of list) {
    assert.deepEqual(Object.keys(row).sort(), ['hits', 'misses', 'outcome', 'rung', 'shape']);
    assert.ok(Number.isInteger(row.rung) && Number.isInteger(row.hits) && Number.isInteger(row.misses));
  }
});

test('a missing, corrupt or wrongly shaped file is just empty: asked again, never a crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ladder-'));
  assert.equal(lookup(ladderStore(path.join(dir, 'nope', 'x.json')), SHAPE), null);
  for (const [name, content] of [['junk', '{not json'], ['array', '[1,2]'], ['null', 'null'], ['wrong', JSON.stringify({kept: {[SHAPE]: 'text', 'a b': {by: 3}}, tally: 5})]]) {
    const file = path.join(dir, `${name}.json`); fs.writeFileSync(file, content);
    const store = ladderStore(file);
    assert.equal(lookup(store, SHAPE), null, name);
    assert.deepEqual(counts(store), [], name);
    assert.equal(record(store, SHAPE, good), true, name);   // and it can learn afterwards
  }
  const readOnly = ladderStore('/nonexistent-dir/ladder.json');
  assert.equal(record(readOnly, SHAPE, good), true);   // cannot write: kept for this run, no crash
});

test('a second shape is independent of the first', () => {
  const {store} = storeIn();
  const other = 'jobs.other.ch/apply|0';
  record(store, SHAPE, good); record(store, other, {...good, outcome: 'link'});
  miss(store, SHAPE);
  assert.equal(lookup(store, SHAPE), null);
  assert.equal(lookup(store, other).outcome, 'link');
  hit(store, other);
  assert.equal(counts(store).find(row => row.shape === SHAPE).hits, 0);
});

test('caps: rung 4 reads the closer look\'s limits, rung 3 has its own', () => {
  assert.deepEqual(capsFor(4), {perShape: CAPS.perShape, perDay: CAPS.perDay});
  const three = capsFor(3);
  assert.ok(three.perShape >= CAPS.perShape && three.perDay >= CAPS.perDay);
  assert.equal(capsFor(0), null); assert.equal(capsFor(2), null);
});

test('the shape pattern is exported for the other ladder stores (one regex, no copies)', async () => {
  const {SHAPE} = await import('../lib/ladder/learning.js');
  assert.ok(SHAPE.test('jobs.example.ch/careers/*|3-7'));
  for (const bad of ['https://a.ch/x?token=1', 'a b/c|0', 'jane@x.example|0', 'host/path']) assert.ok(!SHAPE.test(bad), bad);
});

// Write-back of the ladder (lib/ladder/learning.js): only a verified decision of rung 3+ is kept for a page shape, one miss drops it; a verified decision of the fast tier
// (rungs 0-2) is only counted; counts carry fixed values only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {capsFor, confirm, counts, hit, ladderStore, lookup, miss, record} from '../lib/ladder/learning.js';
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
  assert.deepEqual(counts(store), [{shape: SHAPE, rung: 3, kind: 'posting', outcome: 'form', hits: 1, misses: 1}]);
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
  confirm(store, 'jobs.third.ch/apply|f3-7', {rung: 2, kind: 'form', outcome: 'form', verified: true});
  const list = counts(store);
  assert.deepEqual(list, [{shape: 'jobs.example.ch/careers/*|3-7', rung: 3, kind: 'posting', outcome: 'form', hits: 1, misses: 0}, {shape: 'jobs.other.ch/apply|0', rung: 4, kind: 'posting', outcome: 'expired', hits: 0, misses: 0},
    {shape: 'jobs.third.ch/apply|f3-7', rung: 2, kind: 'form', outcome: 'form', hits: 1, misses: 0}]);
  for (const row of list) {
    assert.deepEqual(Object.keys(row).sort(), ['hits', 'kind', 'misses', 'outcome', 'rung', 'shape']);
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

// The fast tier's own decisions (0 structure, 1 kept, 2 sketch) are kept by rung 1's store (rung1-kept.js); what the page confirmed of them is COUNTED here, so the CI pool, the replays and
// real use feed the same counts (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1). Counting changes no decision: nothing is kept, lookup stays empty.
test('a verified decision of the fast tier (rungs 0-2) is counted for its shape, never kept', () => {
  const {store} = storeIn();
  const form = {rung: 2, kind: 'form', outcome: 'form', verified: true};
  assert.equal(confirm(store, SHAPE, form), true);
  assert.equal(confirm(store, SHAPE, form), true);
  assert.equal(lookup(store, SHAPE), null);   // the decision stays rung 1's (page-kinds.json): no learned answer answers in its place
  assert.deepEqual(counts(store), [{shape: SHAPE, rung: 2, kind: 'form', outcome: 'form', hits: 2, misses: 0}]);
  assert.equal(confirm(store, SHAPE, {...form, verified: false}), false);
  for (const rung of [3, 4, 7, -1, 1.5, '2']) assert.equal(confirm(storeIn().store, SHAPE, {...form, rung}), false, `rung ${rung}`);   // rung 3+ is record()'s
  for (const bad of [{kind: 'a sentence'}, {outcome: 'sent to jane@x.example'}, {kind: ''}]) assert.equal(confirm(storeIn().store, SHAPE, {...form, ...bad}), false, JSON.stringify(bad));
  assert.equal(confirm(storeIn().store, 'https://a.ch/x?token=1', form), false);
  for (const rung of [0, 1]) assert.equal(confirm(storeIn().store, SHAPE, {...form, rung}), true, `rung ${rung}`);
});

test('a changed fast-tier decision for a shape counts from one again; its misses stay', () => {
  const {store} = storeIn();
  confirm(store, SHAPE, {rung: 2, kind: 'posting', outcome: 'form', verified: true});
  confirm(store, SHAPE, {rung: 2, kind: 'posting', outcome: 'form', verified: true});
  assert.equal(miss(store, SHAPE), false);   // nothing kept was dropped...
  assert.deepEqual(counts(store), [{shape: SHAPE, rung: 2, kind: 'posting', outcome: 'form', hits: 2, misses: 1}]);   // ...but the page's contradiction is counted
  confirm(store, SHAPE, {rung: 0, kind: 'form', outcome: 'form', verified: true});
  assert.deepEqual(counts(store), [{shape: SHAPE, rung: 0, kind: 'form', outcome: 'form', hits: 1, misses: 1}]);
});

test('a kept answer of a higher rung is never overwritten by a fast-tier count', () => {
  const {store} = storeIn();
  record(store, SHAPE, good);
  assert.equal(confirm(store, SHAPE, {rung: 2, kind: 'form', outcome: 'form', verified: true}), false);   // the kept answer is confirmed by hit(), not here
  assert.equal(lookup(store, SHAPE).by, 3);
  assert.deepEqual(counts(store), [{shape: SHAPE, rung: 3, kind: 'posting', outcome: 'form', hits: 0, misses: 0}]);
});

test('fast-tier counts carry no text, whatever a caller passes', () => {
  const {file, store} = storeIn();
  const sentence = 'Please send your CV to jane.doe@secret-employer.example before Friday';
  confirm(store, SHAPE, {rung: 2, kind: 'form', outcome: 'form', verified: true, text: sentence, url: 'https://x.example/a?token=abc123', applyButton: sentence, controls: [{label: sentence}]});
  const raw = fs.readFileSync(file, 'utf8');
  for (const needle of ['jane', 'secret-employer', 'Friday', 'token', 'abc123', 'CV']) assert.ok(!raw.includes(needle), `${needle} leaked`);
  assert.deepEqual(Object.keys(JSON.parse(raw).tally[SHAPE]).sort(), ['hits', 'kind', 'misses', 'outcome', 'rung']);
});

test('every shape rung 1 can make is a shape here: the 8+ bucket too (a form with 8 or more fields was never counted before 12 Oct 2026)', async () => {
  const {SHAPE: pattern} = await import('../lib/ladder/learning.js');
  const {kindKey} = await import('../lib/ladder/rung1-kept.js');
  const {otherStore, record: other, counts: otherCounts} = await import('../lib/ladder/other.js');
  const many = n => Array.from({length: n}, () => ({type: 'text'}));
  for (const controls of [[], many(1), many(3), many(8), [...many(9), {type: 'password'}, {type: 'file'}, {type: 'textarea'}]]) {
    const shape = kindKey({url: 'https://jobs.lever.example/acme/1234-5678/apply', controls});
    assert.ok(pattern.test(shape), shape);
    assert.equal(confirm(storeIn().store, shape, {rung: 2, kind: 'form', outcome: 'form', verified: true}), true, shape);
    const store = otherStore(fileIn()); other(store, shape);
    assert.equal(otherCounts(store).length, 1, `other.js: ${shape}`);
  }
});

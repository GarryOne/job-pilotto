// The recording-side guards (lib/record-guard.mjs, records-publish.mjs): every refusal fails on a fixture record, and the owner's named accept lifts only the pinned and worse ones.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {judgeRecords, latin1Image, memoProblem, mojibakeBodies, notWorse, report} from '../lib/record-guard.mjs';

const form = (filled, left) => ({reached: 'form', filled, left});
const replay = ({hit = 4, asks = 4, extra = 0, outcome = form(8, 4), live = form(8, 4)} = {}) => ({outcome, liveOutcome: live, live: {asks}, network: {hit, extra, notRecorded: 0}});
// a record folder: bodies (hash -> bytes), asks.jsonl lines, model-memo.json (object, or null for none)
function folder({bodies = {}, asks = 2, memo = {a: 1, b: 2}} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-guard-'));
  fs.mkdirSync(path.join(dir, 'bodies'));
  for (const [hash, bytes] of Object.entries(bodies)) fs.writeFileSync(path.join(dir, 'bodies', hash), bytes);
  fs.writeFileSync(path.join(dir, 'asks.jsonl'), Array.from({length: asks}, (_, at) => JSON.stringify({at})).join('\n'));
  if (memo !== null) fs.writeFileSync(path.join(dir, 'model-memo.json'), JSON.stringify(memo));
  return dir;
}
const doubled = text => Buffer.from(Buffer.from(text, 'utf8').toString('latin1'), 'utf8');   // UTF-8 read as Latin-1, stored as UTF-8 again
const item = (name, over = {}) => ({name, dir: folder(), replay: replay(), replaced: undefined, ...over});
const checks = result => result.refusals.map(one => `${one.row}:${one.check}`);

test('mojibake is the Latin-1 image of valid UTF-8, never a grep for "Ã"', () => {
  assert.equal(latin1Image(doubled('détail – Zürich').toString('utf8')), true);
  assert.equal(latin1Image('détail – Zürich'), false, 'real accents are faithful');
  assert.equal(latin1Image('Ã'), false, 'a lone A-tilde is not valid UTF-8 as Latin-1 bytes');
  assert.equal(latin1Image('plain ascii'), false);
  assert.equal(latin1Image('日本語'), false);
  assert.deepEqual(mojibakeBodies(folder({bodies: {good: Buffer.from('détail', 'utf8'), bad: doubled('détail'), bin: Buffer.from([0xff, 0x00, 0xc3, 0x28])}})), ['bad']);
});

test('a record with a double-encoded page, or without the live run\'s kept answers, is refused', () => {
  const result = judgeRecords([item('mojibake', {dir: folder({bodies: {bad: doubled('Cloudera Careers – détail')}})}), item('no memo', {dir: folder({memo: null})}), item('empty memo', {dir: folder({memo: {}})}), item('no asks, no memo needed', {dir: folder({asks: 0, memo: null})})]);
  assert.deepEqual(checks(result), ['mojibake:text', 'no memo:answers', 'empty memo:answers']);
  assert.match(report(result), /refused: mojibake: text: 1 kept page\(s\) are double-encoded/);
  assert.match(report(result), /to proceed: /);
  assert.match(memoProblem(folder({memo: {}})), /keeps no answer/);
});

test('a record whose own replay did not run, or stops before the step live reached, is refused', () => {
  assert.deepEqual(checks(judgeRecords([item('none', {replay: null})])), ['none:replay']);
  assert.deepEqual(checks(judgeRecords([item('short', {replay: replay({outcome: {reached: 'posting'}})})])), ['short:step']);
});

test('a pinned row must replay same as live before it replaces its record; only the owner\'s named accept lifts it', () => {
  const broken = replay({hit: 3, extra: 1}), pins = ['p'];
  assert.deepEqual(checks(judgeRecords([item('p', {replay: broken, replaced: null})], {pins})), ['p:pinned']);
  assert.deepEqual(checks(judgeRecords([item('p', {replay: replay(), replaced: null})], {pins})), []);
  assert.deepEqual(checks(judgeRecords([item('q', {replay: broken, replaced: null})], {pins})), [], 'an unpinned row is not held to same');
  assert.deepEqual(checks(judgeRecords([item('p', {replay: broken, replaced: null})], {pins, accepts: ['intended']})), ['p:pinned'], 'a bare reason accepts nothing');
  const named = judgeRecords([item('p', {replay: broken, replaced: null})], {pins, accepts: ['p — one slot per upload widget']});
  assert.deepEqual(checks(named), []);
  assert.match(report(named), /accepted by the owner \(one slot per upload widget\)/);
  assert.deepEqual(checks(judgeRecords([item('p', {replay: broken, replaced: null}), item('r', {replay: broken, replaced: null})], {pins: ['p', 'r'], accepts: ['p — ok']})), ['r:pinned'], 'the accept covers only the row it names');
});

test('a record cannot replace a better one: a lower step or fewer boxes filled is refused (the Aldi case)', () => {
  const old = replay({live: form(10, 2)});
  assert.equal(notWorse(form(10, 2), form(10, 2)), '');
  assert.equal(notWorse(form(12, 0), form(10, 2)), '');
  assert.match(notWorse(form(8, 4), form(10, 2)), /fills 8, the record it replaces fills 10/);
  assert.match(notWorse({reached: 'posting'}, form(1, 1)), /reaches posting, the record it replaces reaches form/);
  assert.deepEqual(checks(judgeRecords([item('a', {replay: replay({live: form(8, 4)}), replaced: old})])), ['a:worse']);
  assert.deepEqual(checks(judgeRecords([item('a', {replay: replay({live: form(10, 2)}), replaced: old})])), []);
  assert.deepEqual(checks(judgeRecords([item('a', {replay: replay({live: form(8, 4)}), replaced: old})], {accepts: ['a — new form is smaller on purpose']})), [], 'the owner\'s named accept lifts it');
  assert.deepEqual(checks(judgeRecords([item('a', {dir: folder({bodies: {bad: doubled('détail')}}), replay: replay({live: form(8, 4)}), replaced: old})], {accepts: ['a — whatever']})), ['a:text'], 'an accept never lifts a double-encoded page');
});

test('without the replaced record, a pinned row is refused ("pass --against") and another row only gets a note', () => {
  const result = judgeRecords([item('p'), item('q')], {pins: ['p']});
  assert.deepEqual(checks(result), ['p:worse']);
  assert.match(result.refusals[0].run, /--against/);
  assert.match(report(result), /note: q: not compared with the record it replaces/);
});

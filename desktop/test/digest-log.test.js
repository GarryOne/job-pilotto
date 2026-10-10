// The digest's validated answer leaves one line in the app's log (ids and fixed words only, never page text): outcome, verb, numbers, press_kind and what the
// validator removed. Why: 11 Oct 2026, a digest answer that was dropped or pressed the wrong control could not be read from the log (the page-kind line said "posting" and nothing else).
// Guards: lib/ladder/rung3-digest.js digestLine, lib/ladder/rung2-sketch.js digestKind (digestSaid), lib/server-pages.js decidePageKind.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {digestLine} from '../lib/ladder/rung3-digest.js';
import {pageKind, pageKindCache} from '../lib/page-kind.js';
import {decidePageKind} from '../lib/server-pages.js';
import {logTo} from '../lib/log.js';

const fake = answer => ({messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 5}, content: [{type: 'text', text: JSON.stringify(answer)}]})}});
const page = {url: 'https://jobs.example.test/detail/9/', title: 'Engineer', headings: ['Engineer'], controls: [], buttons: ['Apply now'], frames: [],
  candidates: [{n: 1, kind: 'button', position: 'main', text: 'Apply now'}, {n: 2, kind: 'phone', position: 'main', text: 'Call Jane Doe on 044 555 01 00'}]};
const cache = () => pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-digest-log-')), 'page-kinds.json'));

test('the digest line is fixed words, numbers and a validator reason; page text never gets in', () => {
  assert.equal(digestLine({outcome: 'form', verb: 'press', numbers: [1], pressKind: 'apply', dropped: ''}), 'digest: outcome=form verb=press numbers=[1] press_kind=apply dropped=-');
  assert.equal(digestLine({outcome: 'phone', verb: 'none', numbers: [], pressKind: '', dropped: 'unknown candidate number'}), 'digest: outcome=phone verb=none numbers=[] press_kind=- dropped=unknown candidate number');
  const dirty = digestLine({outcome: 'Call Jane Doe on 044 555 01 00', verb: 'press', numbers: [1, 'Apply now'], pressKind: 'apply now', dropped: 'jane@doe.example'});
  for (const text of ['Jane', '044', 'Apply now', 'jane@']) assert.equal(dirty.includes(text), false, `${text} must not reach the log`);
});

test('a digest answer carries what to log, on the confident, the dropped and the unsure path', async () => {
  const good = await pageKind(fake({outcome: 'form', verb: 'press', numbers: [1], press_kind: 'apply', confidence: 0.9}), page, cache(), {digest: true});
  assert.deepEqual(good.digestSaid, {outcome: 'form', verb: 'press', numbers: [1], pressKind: 'apply', dropped: ''});
  const dropped = await pageKind(fake({outcome: 'form', verb: 'press', numbers: [99], press_kind: 'apply', confidence: 0.9}), page, cache(), {digest: true});
  assert.equal(dropped.digestSaid.dropped, 'unknown candidate number');
  assert.deepEqual(dropped.digestSaid.numbers, []);
  const unsure = await pageKind(fake({outcome: 'phone', verb: 'tell_person', numbers: [2], press_kind: '', confidence: 0.3}), page, cache(), {digest: true});
  assert.deepEqual([unsure.digestSaid.outcome, unsure.digestSaid.verb, unsure.digestSaid.numbers], ['phone', 'tell_person', [2]]);
});

test('the endpoint writes the digest line to the app log, next to the page-kind line', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-digest-log-app-'));
  logTo(dir);
  const storage = {path: name => path.join(dir, name), settings: () => ({})};
  const decide = async () => ({kind: 'posting', role: 'no-form', by: 'digest', rung: 3, signal: 'confident', confidence: 0.9, shape: 'jobs.example.test/detail/*|0', digestSaid: {outcome: 'form', verb: 'press', numbers: [1], pressKind: 'apply', dropped: ''}});
  await decidePageKind(storage, {url: page.url, digest: true, controls: [], buttons: ['Apply now'], candidates: page.candidates}, {decide, client: null});
  const log = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
  assert.match(log, /\[extension\] digest: outcome=form verb=press numbers=\[1\] press_kind=apply dropped=-/);
  logTo(path.join(os.tmpdir(), 'jp-digest-log-off'));
});

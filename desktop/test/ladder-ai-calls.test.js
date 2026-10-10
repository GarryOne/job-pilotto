// The reader of a pool replay candidate's `ai-calls.json` ([{route, at, request, answer}], written by the e2e harness's app-side capture): a fixture built from what the APP REALLY SENT, not from a
// sketch rebuilt offline from the saved page (the load-time sketch of datadog-greenhouse-frame lacked the frame candidate the live request had). Scrubbed like the recorded pages: no query string, no
// address or phone number. The writer is b8's (3cc8788); this reads it. Guard: e2e/lib/ladder-ai-calls.mjs; the sample below has the real file's shape (a plain ask, then a digest ask with candidates).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {candidatesFromRequest, readAiCalls, requestOf, sketchFromRequest} from '../e2e/lib/ladder-ai-calls.mjs';
import {candidateFixture} from '../e2e/lib/ladder-candidates.mjs';
import {SKETCH_FIELDS} from '../lib/ladder/rung2-sketch.js';

const ask = {url: 'https://jobs.example.ch/detail/9/?token=abc#x', title: 'Verkaufsberater', headings: ['Verkaufsberater'], controls: [], buttons: ['Bewerben', 'Teilen'], frames: ['job-boards.example-ats.io'],
  mails: ['Bewerbung an jane.doe@firma.ch oder 044 555 01 00'], frameCandidates: [{host: 'job-boards.example-ats.io', path: '/embed/job_app', width: 650, height: 2432, src: 'https://job-boards.example-ats.io/embed/job_app?token=secret'}],
  fresh: false, digest: false};
const digestAsk = {...ask, digest: true, candidates: [{n: 1, kind: 'link', position: 'main', host: 'www.example.ch', text: 'Mail jane.doe@firma.ch'}, {n: 2, kind: 'sentence', position: 'main', text: 'Rufen Sie 044 555 01 00 an'}]};
const calls = [
  {route: '/extension/page-kind', at: 1791674935806, request: ask, answer: {kind: 'posting', by: 'ai', confidence: 0.6, formFrame: -1}},
  {route: '/extension/answer', at: 1791674940000, request: {label: 'x'}, answer: {}},
  {route: '/extension/page-kind', at: 1791674950957, request: digestAsk, answer: {kind: 'posting', by: 'digest', confidence: 0.9, digestSaid: {outcome: 'phone'}}},
];
const folder = (content = JSON.stringify(calls)) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ai-calls-')); if (content !== null) fs.writeFileSync(path.join(dir, 'ai-calls.json'), content); return dir; };

test('only well-formed page-kind calls are read; a missing, broken or non-list file reads as nothing', () => {
  assert.deepEqual(readAiCalls(folder()).map(call => call.at), [1791674935806, 1791674950957]);
  for (const content of [null, 'not json', '{"a":1}', '[{"route":"/extension/page-kind"}]']) assert.deepEqual(readAiCalls(folder(content)), []);
});

test('the rung-2 ask and the digest ask are told apart by the request\'s own digest flag', () => {
  const read = readAiCalls(folder());
  assert.equal(requestOf(read, {digest: false}).request.digest, false);
  assert.equal(requestOf(read, {digest: true}).request.candidates.length, 2);
  assert.equal(requestOf([], {digest: true}), null);
});

test('the sketch has only the declared sketch fields, no query string, no address or phone, and frame candidates without their address', () => {
  const sketch = sketchFromRequest(ask);
  assert.deepEqual(Object.keys(sketch).filter(key => !['url', ...SKETCH_FIELDS].includes(key)), [], 'only declared fields');
  assert.equal(sketch.url, 'https://jobs.example.ch/detail/9/');
  assert.deepEqual(sketch.frameCandidates, [{host: 'job-boards.example-ats.io', path: '/embed/job_app', width: 650, height: 2432}]);
  const text = JSON.stringify(sketch);
  for (const leak of ['jane.doe', '044 555', 'token', 'secret']) assert.equal(text.includes(leak), false, `${leak} must not reach a fixture`);
});

test('the address path is kept as it is: a long id in it is not a phone number', () => {
  const sketch = sketchFromRequest({...ask, url: 'https://www.jobs.ch/en/vacancies/detail/a47dffef-1a4f-45cd-bc12-8c4411223344f/?utm=x'});
  assert.equal(sketch.url, 'https://www.jobs.ch/en/vacancies/detail/a47dffef-1a4f-45cd-bc12-8c4411223344f/');
});

test('the digest\'s candidates keep their number, kind and position, and are scrubbed', () => {
  const candidates = candidatesFromRequest(digestAsk);
  assert.deepEqual(candidates.map(item => [item.n, item.kind]), [[1, 'link'], [2, 'sentence']]);
  assert.equal(JSON.stringify(candidates).includes('jane.doe'), false);
  assert.equal(JSON.stringify(candidates).includes('044 555'), false);
  assert.deepEqual(candidatesFromRequest({}), []);
});

test('a candidate fixture built from the request says what the app answered, stays pending, and is a real-source capture', () => {
  const read = readAiCalls(folder());
  const first = requestOf(read, {digest: false}), digest = requestOf(read, {digest: true});
  const fixture = candidateFixture({name: 'jobs-example', day: '2026-10-11', caseJson: {shape: 'a posting', run: {reached: 'posting', path: []}, pages: [{url: 'https://jobs.example.ch/detail/9/?token=abc'}]},
    sketch: sketchFromRequest(first.request), candidates: candidatesFromRequest(digest.request), observed: first.answer, fromRequest: true});
  assert.equal(fixture.source, 'captured');
  assert.deepEqual(fixture.expect, {outcome: 'pending'});
  assert.match(fixture.note, /the app answered posting by ai at 0\.6/);
  assert.equal(fixture.capture.request, 'ai-calls.json');
  assert.deepEqual(fixture.sketch.frameCandidates.length, 1);
  const long = candidateFixture({name: 'long-id', day: '2026-10-11', caseJson: {pages: [{url: 'https://www.jobs.ch/en/vacancies/detail/a47dffef-1a4f-45cd-bc12-8c4411223344f/?x=1'}]},
    sketch: sketchFromRequest({...ask, url: 'https://www.jobs.ch/en/vacancies/detail/a47dffef-1a4f-45cd-bc12-8c4411223344f/?x=1'}), candidates: []});
  assert.equal(long.sketch.url, 'https://www.jobs.ch/en/vacancies/detail/a47dffef-1a4f-45cd-bc12-8c4411223344f/', 'the fixture keeps the address path too');
});

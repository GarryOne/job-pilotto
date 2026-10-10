// lib/live-capture.js: the live page-kind request and answer, kept for a pool replay candidate (owner, 11 Oct 2026). Local only; written ONLY under the e2e harness's
// LIVE_CAPTURE_DIR; scrubbed before writing, in the style of recorded-privacy.test.js. This module has no outward path (no network, no Telegram): the twin's list of outward paths needs no entry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {captureCall, scrub} from '../lib/live-capture.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-live-capture-'));
const request = {url: 'https://jobs.example.ch/job/42?token=SECRET&utm=1', title: 'Seller (m/f) mail anna.muster@gmail.com', headings: ['Apply, call +41 79 123 45 67'],
  controls: [{tag: 'input', type: 'text', label: 'First name', value: 'Anna'}, {tag: 'a', text: 'Apply now', href: 'https://jobs.example.ch/apply?session=XYZ'}], buttons: ['Apply now'],
  candidates: [{index: 3, label: 'Apply now'}], frameCandidates: [{host: 'job-boards.greenhouse.io', w: 650, h: 2432}], digest: true, fresh: false, cookie: 'abc', password: 'hunter2'};
const answer = {ok: true, kind: 'form', role: 'form', by: 'ai', rung: 2, confidence: 0.9, applyButton: 'Apply now', form_frame: -1};

test('scrub: no query string, no email but example, no phone, no typed value, no secrets', () => {
  const text = JSON.stringify(scrub(request));
  assert.ok(!/\?[a-z]+=/i.test(text), 'a URL query string');
  assert.ok(!/gmail|anna\.muster/i.test(text), 'an email');
  assert.ok(!/\+41|123 45 67/.test(text), 'a phone number');
  assert.ok(!/"value":/.test(text) && !/Anna"/.test(text), 'a typed value');
  assert.ok(!/SECRET|XYZ|hunter2|"cookie"|"password"/.test(text), 'a secret');
  assert.deepEqual(scrub(request).candidates, request.candidates);   // the structure the fixture needs is kept
  assert.deepEqual(scrub(request).frameCandidates, request.frameCandidates);
  assert.equal(scrub(request).digest, true);
});

test('no LIVE_CAPTURE_DIR, no code path: nothing is written anywhere', () => {
  const places = [process.cwd(), os.tmpdir(), os.homedir()], seen = () => places.map(place => fs.existsSync(path.join(place, 'ai-calls.json')));
  const before = seen();
  assert.equal(captureCall({route: '/extension/page-kind', request, answer}, {env: {}}), false);
  assert.equal(captureCall({route: '/extension/page-kind', request, answer}, {env: {LIVE_CAPTURE_DIR: ''}}), false);
  assert.deepEqual(seen(), before);   // no ai-calls.json appeared in the working folder, the temp folder or home
});

test('with LIVE_CAPTURE_DIR the calls are appended, scrubbed, as [{route, at, request, answer}]', () => {
  const dir = tmp(), env = {LIVE_CAPTURE_DIR: dir};
  assert.equal(captureCall({route: '/extension/page-kind', request, answer}, {env, now: () => 1}), true);
  assert.equal(captureCall({route: '/extension/page-kind', request: {...request, digest: false}, answer: {...answer, kind: 'posting'}}, {env, now: () => 2}), true);
  const calls = JSON.parse(fs.readFileSync(path.join(dir, 'ai-calls.json'), 'utf8'));
  assert.deepEqual(calls.map(call => [call.route, call.at, call.answer.kind]), [['/extension/page-kind', 1, 'form'], ['/extension/page-kind', 2, 'posting']]);
  const text = fs.readFileSync(path.join(dir, 'ai-calls.json'), 'utf8');
  assert.ok(!/SECRET|XYZ|hunter2|gmail|\+41|"value":/.test(text), 'the written file holds a private value');
  assert.deepEqual(fs.readdirSync(dir), ['ai-calls.json']);
});

test('it never throws and never writes outside the folder it was given (a failing disk, an odd body)', () => {
  const env = {LIVE_CAPTURE_DIR: path.join(tmp(), 'not', 'a', 'dir', '\0bad')};
  assert.doesNotThrow(() => captureCall({route: '/x', request: undefined, answer: undefined}, {env}));
  assert.equal(captureCall({route: '/x', request, answer}, {env}), false);
});

test('it never writes into the real data folder of the app', () => {
  const real = path.join(os.homedir(), 'Library', 'Application Support');
  assert.equal(captureCall({route: '/x', request, answer}, {env: {LIVE_CAPTURE_DIR: path.join(real, 'Job Pilotto', 'x')}}), false);
});

test('the shipped app source calls it in one place and only through captureCall', () => {
  const source = fs.readFileSync(new URL('../lib/server-pages.js', import.meta.url), 'utf8');
  assert.equal((source.match(/captureCall\(/g) || []).length, 1);
  assert.ok(!/LIVE_CAPTURE_DIR/.test(source), 'the env var is read only inside lib/live-capture.js');
});

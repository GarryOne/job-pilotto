// The CV is read once when it is set (lib/cv-import-at-upload.js): cv.json exists right after an upload, the same file never costs a second call,
// a failing import never blocks the upload, and every path that sets the CV goes through the same function.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cv from '../lib/cv.js';
import * as atUpload from '../lib/cv-import-at-upload.js';
import {createStorage} from '../lib/storage.js';

const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-cvup-')), {encrypt: v => v, decrypt: v => v});
const CV = {name: 'Ada Example', summary: 'SRE.', links: [], jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Ran incidents.']}]}],
  education: [{school: 'ETH', degree: 'MSc', period: '2015 – 2018'}]};
const fakeClient = (calls, {fail = false} = {}) => ({messages: {create: async () => {
  calls.push(1);
  if (fail) throw new Error('model unavailable');
  return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(CV)}], usage: {input_tokens: 10, output_tokens: 10}};
}}});
const pdf = (text = 'one') => { const file = path.join(os.tmpdir(), `cvup-${Math.random().toString(36).slice(2)}.pdf`); fs.writeFileSync(file, `%PDF ${text}`); return file; };
const setup = (client, storage = tempStorage()) => ({storage, run: file => atUpload.setCv(storage, file, 'cv.pdf', {client, key: '', toast: () => {}})});

test('right after an upload cv.json exists (the import runs in the background, the upload returns first)', async () => {
  const calls = [], {storage, run} = setup(fakeClient(calls));
  const {name, done} = run(pdf());
  assert.equal(name, 'cv.pdf');
  assert.equal(fs.existsSync(storage.path('cv.pdf')), true, 'the file is in place before the import finishes');
  await done;
  assert.deepEqual(cv.baseCv(storage).education, CV.education);
  assert.equal(calls.length, 1);
});

test('the same file again makes no AI call; a different file does', async () => {
  const calls = [], {run} = setup(fakeClient(calls));
  await run(pdf('same')).done; await run(pdf('same')).done;
  assert.equal(calls.length, 1, 'same bytes: one call');
  await run(pdf('other')).done;
  assert.equal(calls.length, 2);
});

test('a failing import does not block the upload: logged, toast, settings say so, and a later try works', async () => {
  const calls = [], toasts = [], storage = tempStorage();
  const bad = atUpload.setCv(storage, pdf(), 'cv.pdf', {client: fakeClient(calls, {fail: true}), key: '', toast: t => toasts.push(t)});
  await bad.done;
  assert.equal(fs.existsSync(storage.path('cv.pdf')), true);
  assert.equal(cv.baseCv(storage), null);
  assert.equal(storage.settings().cvImport.state, 'failed');
  assert.equal(toasts.length, 1);
  await atUpload.ensure(storage, {client: fakeClient(calls), key: ''});   // Tailor's own path retries
  assert.ok(cv.baseCv(storage));
});

test('no AI chosen yet: nothing is called, the upload stands, the import waits for Tailor', async () => {
  const storage = tempStorage();
  const {done} = atUpload.setCv(storage, pdf(), 'cv.pdf', {client: null, key: '', toast: () => {}});
  await done;
  assert.equal(cv.baseCv(storage), null);
  assert.equal(storage.settings().cvImport.state, 'waiting-for-ai');
});

test('two imports at once share one call (upload and Tailor racing)', async () => {
  const calls = [], storage = tempStorage();
  fs.writeFileSync(storage.path('cv.pdf'), '%PDF race');
  const ai = fakeClient(calls);
  await Promise.all([atUpload.ensure(storage, {client: ai, key: ''}), atUpload.ensure(storage, {client: ai, key: ''})]);
  assert.equal(calls.length, 1);
});

// The class: every path that sets the CV, and every caller that imports it, goes through lib/cv-import-at-upload.js.
const lib = path.join(import.meta.dirname, '..', 'lib');
const sources = fs.readdirSync(lib).filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(lib, f), 'utf8')]);

test('only cv-import-at-upload.js calls cvChange.replace (every CV-setting path sets the CV through setCv)', () => {
  const callers = sources.filter(([f, s]) => /cvChange\.replace\(|\bcv-change\.js'.*replace\b/.test(s) && f !== 'cv-change.js').map(([f]) => f);
  assert.deepEqual(callers, ['cv-import-at-upload.js']);
});

test('every ipc handler that picks a CV calls setCv; nobody else writes cv.pdf', () => {
  const setters = sources.filter(([, s]) => /ipcMain\.handle\('chooseCv'/.test(s));
  assert.ok(setters.length >= 1);
  for (const [f, s] of setters) assert.match(s, /atUpload\.setCv\(/, `${f} must set the CV through setCv`);
  const writers = sources.filter(([, s]) => /copyFileSync\([^)]*,\s*(current|storage\.path\('cv\.pdf'\))/.test(s) || /writeFileSync\(storage\.path\('cv\.pdf'\)/.test(s)).map(([f]) => f);
  assert.deepEqual(writers, ['cv-change.js']);
});

test('every importPdf caller goes through ensure (hash-checked, shared in-flight call), except the explicit re-import', () => {
  const callers = sources.filter(([f, s]) => /importPdf\(/.test(s) && !['cv.js', 'cv-import-at-upload.js'].includes(f));
  const raw = callers.flatMap(([f, s]) => s.split('\n').filter(l => /importPdf\(/.test(l) && !/atUpload\.ensure|force/.test(l)).map(l => `${f}: ${l.trim().slice(0, 60)}`));
  assert.deepEqual(raw, [], 'use atUpload.ensure(storage, {...}) (or {force: true} for the explicit re-import button)');
});

test('a second CV picked while the first is still being read is read too, and import.json never names a PDF its cv.json was not read from (issue #355)', async () => {
  const calls = [], storage = tempStorage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const slow = {messages: {create: async () => {
    const n = calls.push(1);
    if (n === 1) await gate;   // the first read is slow: the person picks another CV meanwhile
    return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({...CV, name: n === 1 ? 'From CV A' : 'From CV B'})}], usage: {input_tokens: 10, output_tokens: 10}};
  }}};
  const first = atUpload.setCv(storage, pdf('A'), 'cv.pdf', {client: slow, key: '', toast: () => {}});
  const second = atUpload.setCv(storage, pdf('B'), 'cv.pdf', {client: slow, key: '', toast: () => {}});
  release();
  await Promise.all([first.done, second.done]);
  assert.equal(calls.length, 2, 'B is read, not skipped because A was running');
  assert.equal(cv.baseCv(storage).name, 'From CV B');
  assert.equal(cv.importedFrom(storage), cv.pdfHash(storage), 'the facts on disk come from the PDF on disk');
});

// Ready to send, the container's pure parts (hosted/ready-fill/): the extension copy holds the account button and points at the stand-in, the stand-in answers from the batch only, a submit is refused,
// the live view lets only mouse and keys through, and the outcome words are the server's. The browser run itself is desktop/e2e/ready-fill-proof.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACCOUNT_PRESS, copyForNight, holdAccountPress} from '../../hosted/ready-fill/extension-copy.mjs';
import {classify} from '../../hosted/ready-fill/fill-job.mjs';
import {inputToCdp} from '../../hosted/ready-fill/live.mjs';
import {costMicro} from '../../hosted/ready-fill/night.mjs';
import {looksLikeSubmit} from '../../hosted/ready-fill/no-submit.mjs';
import {createStandIn} from '../../hosted/ready-fill/stand-in.mjs';

const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');

test('the night copy holds the account press, points at the stand-in and leaves extension/ alone', () => {
  const before = fs.readFileSync(path.join(EXTENSION, 'account-step.js'), 'utf8');
  assert.ok(before.includes(ACCOUNT_PRESS), 'extension/account-step.js still has the press line this copy holds: if it moved, update hosted/ready-fill/extension-copy.mjs');
  const copy = copyForNight(41234, EXTENSION);
  try {
    const held = fs.readFileSync(path.join(copy, 'account-step.js'), 'utf8');
    assert.ok(held.includes('if (false && move === \'fill-press\''), 'the account button is never pressed');
    assert.ok(held.includes('HELD for the night'));
    assert.ok(fs.readFileSync(path.join(copy, 'flow.js'), 'utf8').includes('http://127.0.0.1:41234'));
    for (const file of fs.readdirSync(copy).filter(name => name.endsWith('.js'))) assert.ok(!fs.readFileSync(path.join(copy, file), 'utf8').includes('127.0.0.1:47111'), file);
    assert.ok(JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json'), 'utf8')).host_permissions.includes('https://*/*'));
  } finally { fs.rmSync(path.dirname(copy), {recursive: true, force: true}); }
  assert.equal(fs.readFileSync(path.join(EXTENSION, 'account-step.js'), 'utf8'), before);   // the source is untouched
  assert.throws(() => holdAccountPress('no press line here'), /no longer contains the press guard/);
});

test('a submit is refused and an upload is not', () => {
  assert.equal(looksLikeSubmit({method: 'POST', url: 'https://jobs.example.com/anything', navigation: true}), true);   // a form submission that navigates
  assert.equal(looksLikeSubmit({method: 'POST', url: 'https://boards-api.example.com/v1/boards/acme/jobs/1/applications', navigation: false}), true);
  assert.equal(looksLikeSubmit({method: 'PUT', url: 'https://x.example.com/api/submit', navigation: false}), true);
  assert.equal(looksLikeSubmit({method: 'POST', url: 'https://uploads.example.com/cv', navigation: false}), false);   // a CV upload on choice: the fill needs it
  assert.equal(looksLikeSubmit({method: 'GET', url: 'https://x.example.com/apply', navigation: true}), false);
});

test('the stand-in answers from the batch by the job address and keeps only counts', async () => {
  const batch = {contact: {first_name: 'Ada'}, jobs: [{id: 'j1', url: 'https://boards.example.com/a/1', title: 'SRE', company: 'Acme', kit: {answers: [{field: 'q1', answer: '8'}]}, cv: 'Q1ZCQVNF', letterPdf: 'TEVUVEVS'},
    {id: 'j2', url: 'https://jobs.example.org/p/2', title: 'Dev', company: 'Nord', kit: null, cv: '', letterPdf: ''}]};
  const app = await createStandIn(batch);
  const call = async (route, init = {}) => (await fetch(`http://127.0.0.1:${app.port}${route}`, init)).json();
  try {
    const me = await call(`/extension/me?url=${encodeURIComponent('https://boards.example.com/a/1#jobpilotto-fill')}`);
    assert.equal(me.contact.first_name, 'Ada'); assert.equal(me.resume.data, 'Q1ZCQVNF'); assert.equal(me.coverLetterFile.data, 'TEVUVEVS');
    assert.equal((await call(`/extension/me?url=${encodeURIComponent('https://jobs.example.org/p/2')}`)).resume, undefined);   // no CV for this job: none invented
    assert.equal((await call(`/extension/kit?url=${encodeURIComponent('https://boards.example.com/a/1')}`)).kit.answers[0].answer, '8');
    assert.equal((await call(`/extension/kit?url=${encodeURIComponent('https://elsewhere.example.com/x')}`)).error, 'not tracked');
    assert.deepEqual(await call('/extension/aliases', {method: 'POST', body: '{}'}), {});   // no Notion, no learned notes, no password: every other call is empty
    assert.deepEqual(await call('/extension/site-password', {method: 'POST', body: '{}'}), {});
    assert.equal(app.outcome('https://boards.example.com/a/1'), null);
    await call('/extension/review', {method: 'POST', body: JSON.stringify({url: 'https://boards.example.com/a/1', role: 'form'})});
    await call('/extension/run', {method: 'POST', body: JSON.stringify({url: 'https://boards.example.com/a/1#x', fields: 9, unfilled: 2, usd: 0.01, trace: [{label: 'secret value row'}]})});
    assert.deepEqual(app.outcome('https://boards.example.com/a/1'), {filled: 9, left: 2, role: 'form', usd: 0.01});   // counts and the role, not the trace
    // a second pass fills only what the first left: its count adds, its "left" is the final state; an update restates the last pass
    await call('/extension/event', {method: 'POST', body: JSON.stringify({type: 'fill-started', url: 'https://boards.example.com/a/1'})});
    assert.equal(app.started('https://boards.example.com/a/1'), 1);
    await call('/extension/run', {method: 'POST', body: JSON.stringify({url: 'https://boards.example.com/a/1', fields: 1, unfilled: 1})});
    assert.deepEqual(app.outcome('https://boards.example.com/a/1'), {filled: 10, left: 1, role: 'form', usd: 0.01});
    await call('/extension/run', {method: 'POST', body: JSON.stringify({url: 'https://boards.example.com/a/1', fields: 2, unfilled: 0, update: 'night-run'})});
    assert.deepEqual(app.outcome('https://boards.example.com/a/1'), {filled: 11, left: 0, role: 'form', usd: 0.01});
    assert.deepEqual(await call('/extension/answer', {method: 'POST', body: '{}'}), {answers: [], usd: 0});   // the fill reads answers.filter: an empty list, never undefined
  } finally { await app.close(); }
});

test('the outcome words: prepared needs a fill with nothing required left; an account page is a wall; no panel is no form', () => {
  assert.deepEqual(classify({outcome: {filled: 9, left: 0, role: 'form'}, panel: true}), {state: 'prepared', wall: ''});
  assert.deepEqual(classify({outcome: {filled: 9, left: 2, role: 'form'}, panel: true}), {state: 'partial', wall: ''});
  assert.deepEqual(classify({outcome: {filled: 4, left: 0, role: 'account'}, panel: true}), {state: 'wall', wall: 'account'});
  assert.deepEqual(classify({outcome: {filled: 0, left: 0, role: 'form'}, panel: true}), {state: 'no-form', wall: ''});
  assert.deepEqual(classify({outcome: null, panel: false, role: ''}), {state: 'no-form', wall: ''});
  assert.deepEqual(classify({outcome: null, panel: false, role: 'account'}), {state: 'wall', wall: 'account'});
  assert.deepEqual(classify({outcome: null, panel: true, role: 'form'}), {state: 'failed', wall: 'no-record'});
});

test('the live view lets only mouse and keys through to the browser', () => {
  assert.deepEqual(inputToCdp({t: 'mouse', type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1, buttons: 1})[0], 'Input.dispatchMouseEvent');
  assert.equal(inputToCdp({t: 'key', key: 'a', text: 'a'})[0], 'Input.dispatchKeyEvent');
  for (const bad of [{t: 'eval', code: 'location="x"'}, {t: 'mouse', type: 'drag'}, {t: 'key', key: 'x'.repeat(40)}, {t: 'navigate', url: 'https://x.test'}, null]) assert.equal(inputToCdp(bad), null, JSON.stringify(bad));
});

test('a job costs its seconds of container plus the AI the extension reported', () => {
  assert.equal(costMicro(80000), 960);   // 80 s at ≈ $0.000012 a second
  assert.equal(costMicro(0, 0.031), 31000);
  assert.equal(costMicro(undefined, undefined), 0);
});

test('a fresh extension worker is written only once chrome.storage exists, and every caller goes through that one wait', async () => {
  const {setExtensionStorage} = await import('../../hosted/ready-fill/extension-storage.mjs');
  const saved = {}, worker = {evaluate: (fn, arg) => fn(arg)};   // runs "in the worker": here, this process's globalThis
  const before = globalThis.chrome;
  try {
    delete globalThis.chrome;
    setTimeout(() => { globalThis.chrome = {storage: {local: {set: async values => Object.assign(saved, values)}}}; }, 150);   // the API appears late, as in the container
    await setExtensionStorage(worker, {workerUrl: 'http://127.0.0.1:5', token: 'night'});
    assert.deepEqual(saved, {workerUrl: 'http://127.0.0.1:5', token: 'night'});
    delete globalThis.chrome;
    await assert.rejects(setExtensionStorage(worker, {a: 1}, 100), /did not appear/);
  } finally { globalThis.chrome = before; if (before === undefined) delete globalThis.chrome; }
  const root = new URL('../../', import.meta.url).pathname;   // the class: no direct chrome.storage write through a worker's evaluate
  for (const dir of ['hosted/ready-fill', 'desktop/e2e/lib', 'desktop/e2e']) for (const file of fs.readdirSync(root + dir).filter(f => f.endsWith('.mjs') && f !== 'extension-storage.mjs')) {
    assert.ok(!/evaluate\([^\n]*chrome\.storage\.local\.set/.test(fs.readFileSync(`${root}${dir}/${file}`, 'utf8')), `${dir}/${file}: use setExtensionStorage (the API is missing right after start)`);
  }
});

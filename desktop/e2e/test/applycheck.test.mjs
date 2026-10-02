// Each judgement of the apply suite fails on a deliberately wrong input, passes on the right one: a check that cannot fail is worthless.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {cvProblems, fillProblems, highlightProblems, leftProblems, submitProblems} from '../lib/applycheck.mjs';
import {FORMS, startForms} from '../lib/forms.mjs';
import {message, startAiProxy} from '../lib/ai-proxy.mjs';

const text = value => ({type: 'text', value, checked: false, files: [], ai: false});
const box = checked => ({type: 'checkbox', value: 'on', checked, files: [], ai: false});

test('fillProblems: a wrong, missing or empty answer is reported; the right one is not', () => {
  const expected = {a: '8', b: 'Yes', c: true};
  const good = {a: text('8'), b: text('Yes'), c: box(true)};
  assert.deepEqual(fillProblems({expected, actual: good}), []);
  assert.match(fillProblems({expected, actual: {...good, a: text('9')}})[0], /a: expected "8", the form has "9"/);
  assert.match(fillProblems({expected, actual: {...good, b: text('')}})[0], /b: expected "Yes"/);
  assert.match(fillProblems({expected, actual: {...good, c: box(false)}})[0], /c: expected ticked/);
  assert.match(fillProblems({expected, actual: {a: text('8')}})[0], /b: the form has no such field/);
});

test('fillProblems: a legal field that was ticked or filled is reported, an untouched one is not', () => {
  assert.deepEqual(fillProblems({left: ['consent'], actual: {consent: box(false)}}), []);
  assert.match(fillProblems({left: ['consent'], actual: {consent: box(true)}})[0], /legal field must be left/);
  assert.match(fillProblems({left: ['sig'], actual: {sig: text('Ada')}})[0], /legal field must be left/);
});

test('cvProblems: no file, another file and a truncated file are reported', () => {
  const cv = {name: 'cv.pdf', size: 1000};
  assert.deepEqual(cvProblems({resume: {files: [{name: 'cv.pdf', size: 1000}]}}, cv), []);
  assert.match(cvProblems({resume: {files: []}}, cv)[0], /no CV attached/);
  assert.match(cvProblems({resume: {files: [{name: 'other.pdf', size: 1000}]}}, cv)[0], /other\.pdf/);
  assert.match(cvProblems({resume: {files: [{name: 'cv.pdf', size: 10}]}}, cv)[0], /10 bytes/);
});

test('submitProblems: a click or submit event on this form is reported, one on another form is not', () => {
  assert.deepEqual(submitProblems([], '/o/x'), []);
  assert.deepEqual(submitProblems([{kind: 'click', form: '/other'}], '/o/x'), []);
  assert.match(submitProblems([{kind: 'click', form: '/o/x'}], '/o/x')[0], /click on Submit/);
  assert.equal(submitProblems([{kind: 'click', form: '/o/x'}, {kind: 'submit', form: '/o/x'}], '/o/x').length, 2);
});

test('highlightProblems: an unmarked AI answer and a marked plain fact are both reported', () => {
  const marked = {...text('long'), ai: true};
  assert.deepEqual(highlightProblems({actual: {why: marked, name: text('Ada')}, ai: ['why'], plain: ['name']}), []);
  assert.match(highlightProblems({actual: {why: text('long')}, ai: ['why']})[0], /not highlighted/);
  assert.match(highlightProblems({actual: {name: marked}, plain: ['name']})[0], /plain fact/);
});

test('leftProblems: an item the panel does not list is reported', () => {
  assert.deepEqual(leftProblems(['Your choice (legal): I agree to the privacy policy'], ['privacy policy']), []);
  assert.match(leftProblems([], ['privacy policy'])[0], /does not list "privacy policy"/);
});

const get = (port, host, path, method = 'GET') => new Promise((resolve, reject) => {
  const request = https.request({host: '127.0.0.1', port, path, method, headers: {host}, rejectUnauthorized: false}, response => {
    let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({status: response.statusCode, body}));
  });
  request.on('error', reject); request.end();
});

test('the fixture forms: each is served on its job-site host with its kit fields, a Submit click is recorded, an unknown page is a 404', async () => {
  const forms = await startForms();
  try {
    for (const [name, form] of Object.entries(FORMS)) {
      const served = await get(forms.port, form.host, form.formPath || form.path);
      assert.equal(served.status, 200, `${name} is served`);
      assert.match(served.body, /type="submit"/, `${name} has a Submit`);
      const html = served.body.replaceAll('\\"', '"');   // a late-rendered field sits inside a script string
      for (const item of form.kit) assert.ok(html.includes(`id="${item.field}"`) || html.includes(`name="${item.field}"`), `${name}: the kit's field ${item.field} is on the form`);
    }
    assert.equal((await get(forms.port, 'boards.greenhouse.io', '/nope')).status, 404);
    assert.equal((await get(forms.port, 'example.com', FORMS.greenhouse.path)).status, 404, 'a fixture path on another host is not served');
    assert.deepEqual(forms.fired, []);
    await get(forms.port, 'boards.greenhouse.io', '/__fired?kind=click&form=%2Fe2e%2Fjobs%2F1', 'POST');
    assert.deepEqual(forms.fired, [{kind: 'click', form: '/e2e/jobs/1'}]);
  } finally { await forms.close(); }
});

test('the AI proxy answers a canned text (the Messages API shape) and passes on what it has no text for', async () => {
  const proxy = await startAiProxy({target: 'http://127.0.0.1:1'});
  try {
    proxy.setCanned(body => (body.messages?.[0]?.content === 'hello' ? 'hi there' : null));
    const ask = content => fetch(`${proxy.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({messages: [{role: 'user', content}]})});
    const canned = await ask('hello');
    assert.equal((await canned.json()).content[0].text, 'hi there');
    assert.equal(proxy.stats.canned, 1);
    assert.equal((await ask('something else')).status, 502, 'a call with no canned text goes on to the target (here unreachable)');
    assert.equal(message('x').content[0].text, 'x');
  } finally { await proxy.close(); }
});

test('the test extension: a copy that talks to the test port, the real folder untouched; a source without the address is refused', async () => {
  const {copyExtension, freePort, EXTENSION_DIR} = await import('../lib/extension.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const original = fs.readFileSync(path.join(EXTENSION_DIR, 'flow.js'), 'utf8');
  const port = await freePort();
  assert.notEqual(port, 47111);
  const dir = copyExtension(port);
  const copy = fs.readFileSync(path.join(dir, 'flow.js'), 'utf8');
  assert.ok(copy.includes(`http://127.0.0.1:${port}`) && !copy.includes('127.0.0.1:47111'), 'the copy points at the test port only');
  assert.equal(fs.readFileSync(path.join(EXTENSION_DIR, 'flow.js'), 'utf8'), original, 'extension/ itself is not edited');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).key, JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8')).key, 'same key, so the same extension id the app pairs with');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-bare-'));
  fs.writeFileSync(path.join(bare, 'flow.js'), 'export const APP = "http://localhost:1";');
  assert.throws(() => copyExtension(port, bare), /no longer contains/);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-other-'));
  fs.writeFileSync(path.join(other, 'flow.js'), `export const APP = "http://127.0.0.1:47111";`);
  fs.writeFileSync(path.join(other, 'extra.js'), `fetch("http://127.0.0.1:47111/x")`);
  assert.throws(() => copyExtension(port, other), /still mentions/);
});

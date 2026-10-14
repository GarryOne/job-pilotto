// "Report this form" wiring (spec 2026-10-15-report-this-form.md §3, §7): every entry point (the panel's flag, the session button, ⌘K) is off with the Settings switch and until the uploader exists,
// nothing records before the person's press, the debugger is used only inside start(), the manifest's permissions are unchanged, and the app side holds, previews, drops hosts and sends only through the gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {registerReportHandlers} from '../lib/report-handlers.js';
import {visitMore} from '../lib/server-hooks.js';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const code = file => read(file).split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
const TEXTS = ['full name: Rosalind Quill\nemail: rosalind.quill@mailbox.test\n'];
const entry = (url, body, type = 'text/html') => ({method: 'GET', url, type: 'document', mode: 'navigate', startMs: 0, waitMs: 5, bodyKey: '', status: 200, failed: false, headers: {'content-type': type}, hadCookie: false, body: Buffer.from(body).toString('base64'), size: body.length});

function harness({uploader = async () => ({ok: true}), settings = {}} = {}) {
  const handlers = {}, sent = [], saved = {};
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  registerReportHandlers({ipcMain, uploader, texts: () => TEXTS, toWindow: (...args) => sent.push(args), getWindow: () => null,
    storage: {settings: () => ({...settings, ...saved}), saveSettings: patch => Object.assign(saved, patch)}});
  return {handlers, sent, route: payload => visitMore['/extension/report-form'](payload)};
}

test('the flag, the session button and ⌘K are all off until the uploader exists and while the switch is off', async () => {
  assert.deepEqual((await harness({uploader: null}).route({action: 'state'})), {ok: true, enabled: false});
  assert.equal((await harness({settings: {reportForm: false}}).route({action: 'state'})).enabled, false);
  const on = harness(); assert.equal((await on.route({action: 'state'})).enabled, true);
  await on.handlers.reportFormSet(null, false); assert.equal((await on.route({action: 'state'})).enabled, false);
  assert.deepEqual(await on.route({action: 'submit', entries: []}), {ok: false, refused: 'off'});
  assert.match(read('desktop/renderer/index.html'), /id="ss-report" hidden/, 'the session button starts hidden');
  assert.match(read('desktop/renderer/pages/nav.js'), /button\('sessions', 'ss-report'/, 'it is in ⌘K, from the same button');
  assert.match(read('desktop/renderer/pages/report-form.js'), /\$\('ss-report'\)\.hidden = !\(on && ready\)/);
  assert.match(read('extension/panel-report.js'), /if \(!state\?\.enabled\) return;\s*flag\.hidden = false/, 'the flag is drawn only when the app says so');
});

test('nothing records before the press: the flag only asks for its state on load; start is sent from a trusted click on "Start recording"', () => {
  const panel = code('extension/panel-report.js');
  assert.deepEqual(panel.match(/type: 'report-[a-z]+'/g), ["type: 'report-cancel'", "type: 'report-stop'", "type: 'report-start'", "type: 'report-state'"].sort((a, b) => panel.indexOf(a) - panel.indexOf(b)));
  assert.ok(/event\.isTrusted/.test(panel) && (panel.match(/event\.isTrusted/g) || []).length >= 2, 'a page\'s script cannot press the buttons');
  assert.match(panel, /The page will reload; answers on this page may be cleared/);
  assert.match(panel, /debugging this browser/);
  assert.match(panel, /Nothing leaves your Mac until you read it and press Send/);
  const recorder = code('extension/report-recorder.js');
  assert.equal((recorder.match(/Page\.reload/g) || []).length, 1);
  assert.ok(recorder.indexOf('Page.reload') > recorder.indexOf('async start('), 'the reload is inside start()');
  assert.ok(recorder.indexOf('Page.reload') < recorder.indexOf('async stop('));
  assert.ok(!/^chrome\.debugger/m.test(recorder), 'no debugger call at load');
});

test('the manifest\'s permissions are what they were: debugger stays a normal permission, nothing new, nothing optional', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'alarms', 'debugger', 'scripting', 'storage', 'webNavigation']);
  assert.ok(!(manifest.optional_permissions || []).includes('debugger'));
});

test('a submitted recording is scrubbed and held, shown to the window, and sent only after the gate once more, without the hosts the person dropped', async () => {
  const uploads = [], h = harness({uploader: async record => { uploads.push(record); return {ok: true}; }});
  const answer = await h.route({action: 'submit', entries: [entry('https://jobs.example.test/apply', '<h1>Hi Rosalind</h1>'), entry('https://cdn.example.test/w.html', '<p>x</p>')], truncated: false});
  assert.deepEqual(answer, {ok: true});
  const [channel, shown] = h.sent[0];
  assert.equal(channel, 'reportFormReady'); assert.deepEqual(shown.preview.hosts.map(one => one.host).sort(), ['cdn.example.test', 'jobs.example.test']);
  assert.ok(!JSON.stringify(shown).match(/Rosalind|Quill|mailbox/), 'the window is shown counts and hosts only');
  assert.equal((await h.handlers.reportFormGet()).shown.id, shown.id);
  assert.deepEqual(await h.handlers.reportFormSend(null, ['cdn.example.test']), {ok: true});
  assert.deepEqual(uploads[0].entries.map(one => new URL(one.url).host), ['jobs.example.test']);
  assert.ok(![...uploads[0].bodies.values()].some(body => /Rosalind/.test(body.toString())), 'what is uploaded is scrubbed');
  assert.deepEqual(await h.handlers.reportFormSend(null, []), {ok: false, error: 'Nothing to send.'}, 'nothing is held after a send');
});

test('a recording the last gate stops is not held; Cancel clears what is held', async () => {
  const h = harness();
  const blocked = await h.route({action: 'submit', entries: [entry('https://jobs.example.test/app.js', 'const quill = 1;', 'application/javascript')]});
  assert.deepEqual(blocked, {ok: false, blocked: ['name-in-code']});
  assert.equal((await h.handlers.reportFormGet()).shown, null);
  await h.route({action: 'submit', entries: [entry('https://jobs.example.test/apply', '<p>x</p>')]});
  await h.handlers.reportFormCancel();
  assert.equal((await h.handlers.reportFormGet()).shown, null);
  assert.deepEqual(await h.handlers.reportFormSend(null, []), {ok: false, error: 'Nothing to send.'});
});

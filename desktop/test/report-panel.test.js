// "Report this form" wiring (spec 2026-10-15-report-this-form.md §3, §7): the panel flag (the only entry point since 16 Oct 2026; no app button, no ⌘K entry) is off with the Settings switch and until the uploader exists,
// nothing records before the person's press, the debugger is used only inside start(), the manifest's permissions are unchanged, and the app side holds, previews, drops hosts and sends only through the gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {registerReportHandlers, reportFormOn} from '../lib/report-handlers.js';
import {visitMore} from '../lib/server-hooks.js';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const code = file => read(file).split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
const TEXTS = ['full name: Rosalind Quill\nemail: rosalind.quill@mailbox.test\n'];
const entry = (url, body, type = 'text/html') => ({method: 'GET', url, type: 'document', mode: 'navigate', startMs: 0, waitMs: 5, bodyKey: '', status: 200, failed: false, headers: {'content-type': type}, hadCookie: false, body: Buffer.from(body).toString('base64'), size: body.length});

const okUploader = {send: async () => ({ok: true}), count: () => 0, deleteAll: async () => ({ok: true, deleted: 0})};
function harness({uploader = okUploader, settings = {}} = {}) {
  const handlers = {}, sent = [], saved = {};
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  registerReportHandlers({ipcMain, uploader, texts: () => TEXTS, toWindow: (...args) => sent.push(args), getWindow: () => null,
    storage: {settings: () => ({...settings, ...saved}), saveSettings: patch => Object.assign(saved, patch)}});
  return {handlers, sent, route: payload => visitMore['/extension/report-form'](payload)};
}

test('the panel flag is off until the uploader exists and while the switch is off; the app has no button or ⌘K entry for it', async () => {
  assert.deepEqual((await harness({uploader: null}).route({action: 'state'})), {ok: true, enabled: false});
  assert.equal((await harness({settings: {reportForm: false}}).route({action: 'state'})).enabled, false);
  const on = harness(); assert.equal((await on.route({action: 'state'})).enabled, true);
  await on.handlers.reportFormSet(null, false); assert.equal((await on.route({action: 'state'})).enabled, false);
  assert.deepEqual(await on.route({action: 'submit', entries: []}), {ok: false, refused: 'off'});
  for (const file of ['desktop/renderer/index.html', 'desktop/renderer/pages/nav.js', 'desktop/renderer/pages/report-form.js']) assert.doesNotMatch(read(file), /ss-report/, `${file}: the flag lives only in the extension panel, no app button or ⌘K entry`);
  assert.match(read('extension/panel-markup.js'), /<div class="foot">[^]*<button class="report-btn"[^>]*>[^]*Report<\/button><\/div>/, 'one Report entry, in the footer of every state');
  assert.doesNotMatch(read('extension/panel-markup.js'), /report-flag|report-open/, 'no header flag, no body button');
  assert.match(read('extension/review.js'), /\$\('\.report-btn'\)\.onclick[^\n]*__jobPilottoReportOpen/, 'it opens the same card as the flag');
  assert.match(read('extension/panel-report.js'), /if \(!state\?\.enabled\) return;\s*flag\.hidden = false/, 'the flag is drawn only when the app says so');
});

test('the press hands over the trace Job Pilotto already keeps: the panel only asks for its state and sends the trace from a trusted click; nothing reloads', () => {
  const panel = code('extension/panel-report.js');
  assert.deepEqual([...new Set(panel.match(/type: 'report-[a-z]+'/g))].sort(), ["type: 'report-send'", "type: 'report-state'"]);
  assert.ok(/event\.isTrusted/.test(panel) && (panel.match(/event\.isTrusted/g) || []).length >= 2, 'a page\'s script cannot press the buttons');
  assert.match(panel, /Nothing leaves your Mac until you read it and press Send/);
  assert.match(panel, /The whole journey \(recommended for fixing\)/);
  assert.match(panel, /Only this page/);
  assert.doesNotMatch(panel, /will reload|Start recording/);
  assert.equal(fs.existsSync(new URL('../../extension/report-recorder.js', import.meta.url)), false, 'the reload-and-record collector is gone');
});

test('the manifest\'s permissions are what they were: debugger stays a normal permission, nothing new, nothing optional', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'alarms', 'debugger', 'scripting', 'storage', 'webNavigation']);
  assert.ok(!(manifest.optional_permissions || []).includes('debugger'));
});

test('a submitted recording is scrubbed and held, shown to the window, and sent only after the gate once more, without the hosts the person dropped', async () => {
  const uploads = [], h = harness({uploader: {...okUploader, send: async record => { uploads.push(record); return {ok: true}; }}});
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

test('the trace switch is on by default and named in plain words in Settings (so ⌘K lists it by its heading) and in the wizard; the bar is explained once', () => {
  const html = read('desktop/renderer/index.html');
  assert.match(html, /<h3>Keep a trace of each form fill<\/h3>/);
  assert.match(html, /<input type="checkbox" id="welcome-trace" checked>/, 'the wizard has one checkbox, on by default');
  assert.match(html, /Stays on this Mac, sent only when you press Report and confirm, never sign-in pages, deleted when the application ends/);
  assert.equal(reportFormOn({settings: () => ({})}), true, 'on for every install that never chose');
  assert.equal(reportFormOn({settings: () => ({reportForm: false})}), false);
  assert.match(read('extension/panel-markup.js'), /Chrome shows a debugging bar while Job Pilotto keeps a trace/);
  assert.match(read('extension/review.js'), /traceBarSeen/);
});

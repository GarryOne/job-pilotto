// Interviews → the library's loading (owner, 30 Sep 2026: after the Insights card landed the page showed only its table
// header: no rows, no skeleton, no Local recordings, no message). Root cause: loadInterviews awaited a fresh job list
// (a Python run, 10–60 s while the app starts) before drawing anything. These keep each part independent and every
// failure visible: the library never waits for the job list, a failed read says why (and keeps the last good rows),
// the Insights part can't blank the library, and a failure is written to app.log.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {mainSource} from './main-source.js';

class FakeNode { constructor() { this.children = []; this.style = {}; } append(...n) { this.children.push(...n); } setAttribute() {} addEventListener() {} }
globalThis.Node ??= FakeNode;
globalThis.document ??= {createElement: () => new FakeNode(), createElementNS: () => new FakeNode(), body: new FakeNode(),
  addEventListener() {}, querySelector: () => null};
globalThis.window ??= {addEventListener() {}};
const {afterLoad, libraryError} = await import('../renderer/interview-library.js');
const {insightView} = await import('../renderer/interview-insight.js');
const interviews = await import('../lib/interviews.js');
const page = fs.readFileSync(new URL('../renderer/pages/interviews.js', import.meta.url), 'utf8');
const body = name => page.slice(page.indexOf(`function ${name}(`), page.indexOf('\n}\n', page.indexOf(`function ${name}(`)));

test('the page draws the library and the local recordings without waiting for the job list', () => {
  const load = body('loadInterviews');
  assert.doesNotMatch(load, /await window\.pilot\.jobs\(\)/, 'a fresh job list takes a Python run: never before drawing');
  assert.ok(load.indexOf('loadSaved(') >= 0 && load.indexOf('loadDrafts(') >= 0);
  assert.doesNotMatch(load, /shared\.allJobs\.length/, 'shared.allJobs may be unset: guard it');
});

test('a read that fails says why, and keeps the rows already shown', () => {
  const rows = [{id: 'iv-1'}];
  assert.deepEqual(afterLoad({ok: true, interviews: rows, insight: null}, {rows: []}),
    {ok: true, rows, insight: null, insightError: '', error: ''});
  const failed = afterLoad({ok: false, error: 'Notion said 502'}, {rows, at: new Date(Date.now() - 5 * 60000).toISOString()});
  assert.equal(failed.rows, rows);
  assert.equal(failed.error, 'Notion said 502');
  assert.match(failed.stats, /Couldn't refresh from Notion.*5 min ago/);
  assert.deepEqual(afterLoad({ok: false}, {rows: []}).error, libraryError(), 'never an empty message');
  assert.deepEqual(afterLoad(undefined, {rows: []}).error, libraryError());
  assert.equal(afterLoad({ok: true}, {rows: []}).ok, false, 'a list without its interviews is a failure, not "no interviews"');
  assert.equal(afterLoad({ok: true, interviews: rows, insight_error: 'HTTPError: 400'}, {rows: []}).insightError, 'HTTPError: 400');
});

test('the Insights view never throws on a row written by another version (fields missing or of another type)', () => {
  const rows = [{id: 'iv-1', title: 'A', overall: 'neutral', application: []}, {id: 'iv-2', title: 'B', overall: 'neutral'}];
  const odd = {headline: 'h', sample: 2, patterns: [{text: 'p'}, {text: 'q', interviews: 'iv-1'}], next_steps: [{text: 's'}],
    interviews: {}, evidence: null};
  assert.doesNotThrow(() => insightView(odd, rows));
  assert.equal(insightView(odd, rows).patterns.length, 2);
  assert.doesNotThrow(() => insightView({}, rows));
  assert.doesNotThrow(() => insightView(null, [{id: 'x', overall: 'good', application: null}]));
});

test('rendering is guarded: a throw in the Insights card or a row never blanks the rest', () => {
  assert.match(body('renderAll'), /try \{ renderSaved\(\); \} catch/);
  assert.match(body('renderAll'), /try \{ renderInsight\(\); \} catch/);
  assert.doesNotMatch(page, /row\.application\[0\] (\?|&&)/, 'application may be missing on a row');
});

test('a failed library read, or an unreadable insight, is written to app.log with the reason', async () => {
  const lines = [];
  const log = (area, message) => lines.push(`[${area}] ${message}`);
  const reply = stdout => async () => ({code: 0, stdout});
  await interviews.saved({}, reply('{"ok": false, "error": "Notion: HTTP Error 400"}'), log);
  await interviews.saved({}, async (_s, _a, onLine) => { onLine('Traceback …'); onLine('KeyError: x'); return {code: 1, stdout: ''}; }, log);
  const good = await interviews.saved({}, reply('{"ok": true, "interviews": [{"id": "iv-1", "title": "Private title"}], "insight": null, "insight_error": "HTTPError: 400"}'), log);
  assert.equal(good.interviews.length, 1);
  assert.deepEqual(lines, ['[interviews] library read failed: Notion: HTTP Error 400', '[interviews] library read failed: KeyError: x',
    '[interviews] insights unreadable (the library still shows): HTTPError: 400']);
  assert.ok(!lines.join('').includes('Private title'), 'never values');
});

test('a window error lands in app.log (type and message), not only in the telemetry queue', () => {
  const main = mainSource();
  const handler = main.slice(main.indexOf("ipcMain.handle('telemetryRecord'"), main.indexOf("ipcMain.handle('telemetryShown'"));
  assert.match(handler, /appLog\('window'/);
});

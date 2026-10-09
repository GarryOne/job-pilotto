// Jobs → a job's page (lib/job-page-handlers.js): one store's record, sections and events through the engine, on every store.
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {fileBytes, jobPage, registerJobPageHandlers} from '../lib/job-page-handlers.js';

const kitMarkdown = 'Drafted.\n\n### Machine-readable kit\n\n```json\n{"cover_letter": "Dear team", "answers": []}\n```';
function fakeStore(app, match = null) {
  const calls = [];
  const call = async (_storage, entity, method, kwargs) => {
    calls.push(`${entity}.${method}`);
    if (entity === 'matches' && method === 'get') return match;
    if (method === 'get') return app;
    if (method === 'sections') return {'📝 Application kit': kitMarkdown};
    if (entity === 'events') return [{kind: 'Applied', at: '2026-10-01'}];
    if (method === 'files') return [{name: 'chat.png', content_type: 'image/png', size: 3, data: 'AAAA'}];
    throw new Error(`unexpected ${entity}.${method}`);
  };
  return {call, calls};
}

test('a tracked job: its sections, its kit as JSON and its events, by its app id', async () => {
  const {call, calls} = fakeStore({id: 'a1', stage: 'Applied'}, {url: 'https://x/1', fit: 82, tier: 'Strong'});
  const page = await jobPage({}, 'https://x/1', {call, links: true});
  assert.deepEqual(calls.sort(), ['applications.files', 'applications.get', 'applications.sections', 'events.list', 'matches.get']);
  assert.equal(page.match.tier, 'Strong', 'the search\'s facts, for the Match tab');
  assert.deepEqual(page.files.map(file => [file.name, file.url]), [['chat.png', 'data:image/png;base64,AAAA']], 'the screenshots, for Messages');
  assert.equal(page.kit.cover_letter, 'Dear team');
  assert.equal(page.events.length, 1);
  assert.equal(page.links, true);
});

test('a job nobody acted on: no application, nothing else read', async () => {
  const {call, calls} = fakeStore(null);
  assert.deepEqual(await jobPage({}, 'https://x/2', {call}), {app: null, match: null, sections: {}, kit: null, events: [], files: [], links: false});
  assert.deepEqual(calls.sort(), ['applications.get', 'matches.get']);
});

test('the IPC: demo mode reads the fictional fixture; a store error is an answer, logged', async () => {
  const handlers = {}, lines = [];
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  registerJobPageHandlers({ipcMain, storage: {}, DEMO: true, here, log: () => {}});
  const demo = await handlers.jobPage(null, 'https://example.com/jobs/1');
  assert.equal(demo.app.company, 'Helvetic Cloud');
  assert.equal(demo.kit.answers.length, 2);
  const storage = {settings: () => ({store: 'sqlite'})};
  registerJobPageHandlers({ipcMain, storage, DEMO: false, here, log: (...line) => lines.push(line), call: async () => { throw new Error('no engine'); }});
  assert.deepEqual(await handlers.jobPage(null, 'https://x/1'), {error: 'no engine'});
  assert.equal(lines[0][1], 'job page not read');
});

test('saving a job file: only a data: URL becomes bytes', () => {
  assert.deepEqual([...fileBytes('data:application/pdf;base64,JVBERg==')], [...Buffer.from('%PDF')]);
  for (const url of ['file:///etc/passwd', 'https://x/cv.pdf', '', 'data:text/plain,hello']) assert.equal(fileBytes(url), null, url);
});

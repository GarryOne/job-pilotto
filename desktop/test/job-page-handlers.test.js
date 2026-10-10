// Jobs → a job's page (lib/job-page-handlers.js): one store's record, sections and events through the engine, on every store.
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {fileBytes, jobCode, jobPage, registerJobPageHandlers} from '../lib/job-page-handlers.js';

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
    if (entity === 'interviews') return [{id: 'iv1', title: 'Screening call', round: 'Screening', at: '2026-10-07T10:00:00'}];
    throw new Error(`unexpected ${entity}.${method}`);
  };
  return {call, calls};
}

test('a tracked job: its sections, its kit as JSON and its events, by its app id', async () => {
  const {call, calls} = fakeStore({id: 'a1', stage: 'Applied'}, {url: 'https://x/1', fit: 82, tier: 'Strong'});
  const page = await jobPage({}, 'https://x/1', {call, links: true});
  assert.deepEqual(calls.sort(), ['applications.files', 'applications.get', 'applications.sections', 'events.list', 'interviews.list', 'matches.get']);
  assert.equal(page.interviews[0].title, 'Screening call', 'its interviews, for the Interviews and Review tabs');
  assert.equal(page.match.tier, 'Strong', 'the search\'s facts, for the Match tab');
  assert.deepEqual(page.files.map(file => [file.name, file.url]), [['chat.png', 'data:image/png;base64,AAAA']], 'the screenshots, for Messages');
  assert.equal(page.kit.cover_letter, 'Dear team');
  assert.equal(page.events.length, 1);
  assert.equal(page.links, true);
});

test('a job nobody acted on: no application, nothing else read', async () => {
  const {call, calls} = fakeStore(null);
  assert.deepEqual(await jobPage({}, 'https://x/2', {call}), {app: null, match: null, sections: {}, kit: null, events: [], files: [], interviews: [], links: false});
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

test('jobPosting: the crawl\'s saved text by the job\'s code; none, and a failure, are answers', async () => {
  const handlers = {}, lines = [];
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const asked = [];
  const posting = async (_storage, code) => {
    asked.push(code);
    if (code === jobCode('https://x/none')) return {ok: false, error: 'job not found'};
    if (code === jobCode('https://x/boom')) throw new Error('python died');
    return {ok: true, description: 'Run SRE', url: 'https://x/1', company: 'Acme', source: 'Acme', source_kind: 'employer feed', first_seen_at: '2026-10-09T08:00:00Z', posted_at: '2026-10-03'};
  };
  registerJobPageHandlers({ipcMain, storage: {}, DEMO: false, here: '.', log: (...line) => lines.push(line), posting});
  assert.deepEqual(await handlers.jobPosting(null, ' https://x/1 '), {ok: true, description: 'Run SRE', url: 'https://x/1', company: 'Acme', source: 'Acme', source_kind: 'employer feed',
    first_seen_at: '2026-10-09T08:00:00Z', posted_at: '2026-10-03'}, 'the text, and where and when it came from');
  assert.equal(asked[0], jobCode('https://x/1'), 'asked by the same code the engine makes from the trimmed URL');
  assert.deepEqual(await handlers.jobPosting(null, 'https://x/none'), {ok: false, error: 'job not found'});
  assert.deepEqual(await handlers.jobPosting(null, 'https://x/boom'), {ok: false, error: 'python died', failed: true});
  assert.equal(lines[0][1], 'job posting not read');
  assert.match(jobCode('https://x/1'), /^[0-9a-f]{8}$/);
});

test('jobPosting in demo mode: a fictional posting for a demo job, none for the rest', async () => {
  const handlers = {};
  const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  registerJobPageHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, storage: {}, DEMO: true, here, log: () => {}});
  const demo = await handlers.jobPosting(null, 'https://example.com/jobs/4');
  assert.match(demo.description, /Responsibilities/);
  assert.equal(demo.source_kind, 'employer feed');
  assert.deepEqual(await handlers.jobPosting(null, 'https://example.com/jobs/1'), {ok: false, error: 'job not found'});
});

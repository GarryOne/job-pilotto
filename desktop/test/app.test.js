import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fakeNotion} from './fake-notion.js';
import {fileURLToPath} from 'node:url';
import * as apply from '../lib/apply.js';
import * as pipeline from '../lib/pipeline.js';
import * as strategy from '../lib/strategy.js';
import {createStorage} from '../lib/storage.js';
import {cleanSecret} from '../lib/secrets.js';

// Stand-in for safeStorage: reversible, and obviously not plain text on disk.
const fakeCrypto = {encrypt: v => Buffer.from(v).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString()};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);

test('secrets are encrypted on disk and only reported as present', () => {
  const storage = tempStorage();
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-secret');
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), 'sk-ant-secret');
  assert.equal(fs.readFileSync(storage.path('secrets.json'), 'utf8').includes('sk-ant-secret'), false);
  assert.equal(storage.secretsPresent().ANTHROPIC_API_KEY, true);
  assert.equal(storage.secretsPresent().NOTION_TOKEN, false);
  assert.throws(() => storage.setSecret('HOME', 'x'));
  storage.setSecret('ANTHROPIC_API_KEY', '');
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), '');
});

test('the pipeline runs on the user folder, with AI models only when a key is set', () => {
  const storage = tempStorage();
  pipeline.ensureConfig(storage);
  assert.ok(fs.existsSync(storage.path('config/search.json')));
  let env = pipeline.pipelineEnv(storage);
  assert.equal(env.JOB_PILOTTO_DATA_DIR, storage.path('data'));
  assert.equal(env.JOB_PILOTTO_PROFILE_FILE, undefined);  // no file on this Mac yet
  assert.equal(env.JOB_PILOTTO_SCORE_MODEL, undefined);
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-x');
  env = pipeline.pipelineEnv(storage);
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-x');
  assert.equal(env.JOB_PILOTTO_SCORE_MODEL, 'claude-sonnet-5-5');
});

test('the end-to-end stand-ins reach the engine only in a test run (its env is a whitelist)', () => {
  const storage = tempStorage();
  const parent = {PATH: '/bin', JOB_PILOTTO_E2E_NOTION_BASE_URL: 'http://127.0.0.1:1', JOB_PILOTTO_E2E_TELEGRAM_BASE_URL: 'http://127.0.0.1:2',
    JOB_PILOTTO_E2E_GOOGLE_BASE_URL: 'http://127.0.0.1:3', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r'};
  const user = pipeline.pipelineEnv(storage, parent);
  assert.equal(user.JOB_PILOTTO_E2E_NOTION_BASE_URL, undefined);
  assert.equal(user.GOOGLE_REFRESH_TOKEN, undefined);
  const e2e = pipeline.pipelineEnv(storage, {...parent, JOB_PILOTTO_E2E: '1'});
  assert.equal(e2e.JOB_PILOTTO_E2E_NOTION_BASE_URL, 'http://127.0.0.1:1');
  assert.equal(e2e.JOB_PILOTTO_E2E_TELEGRAM_BASE_URL, 'http://127.0.0.1:2');
  assert.equal(e2e.JOB_PILOTTO_E2E_GOOGLE_BASE_URL, 'http://127.0.0.1:3');
  assert.equal(e2e.GOOGLE_REFRESH_TOKEN, 'r');
});

test('Trying (no Notion): the engine reads the Profile and answers from this Mac; connected, it never does', () => {
  const storage = tempStorage();
  storage.writeText('profile.md', 'P');
  assert.equal(pipeline.pipelineEnv(storage).JOB_PILOTTO_PROFILE_FILE, storage.path('profile.md'));
  assert.equal(pipeline.pipelineEnv(storage).JOB_PILOTTO_ANSWERS_FILE, undefined);  // no answers.md
  storage.writeText('answers.md', 'A');
  assert.equal(pipeline.pipelineEnv(storage).JOB_PILOTTO_ANSWERS_FILE, storage.path('answers.md'));
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile'}});
  const env = pipeline.pipelineEnv(storage);
  assert.equal(env.JOB_PILOTTO_PROFILE_FILE, undefined);  // Notion is the source of truth once connected
  assert.equal(env.JOB_PILOTTO_ANSWERS_FILE, undefined);
});

test('apply picks saved jobs first, then the best fit, only with a kit, never applied or dismissed ones', () => {
  const jobs = [
    {url: 'a', status: 'unreviewed', fit: 60, kit: true}, {url: 'b', status: 'applied', fit: 95, kit: true},
    {url: 'c', status: 'saved', fit: 40, kit: true}, {url: 'd', status: 'unreviewed', fit: 88, kit: true},
    {url: 'e', status: 'dismissed', fit: 99, kit: true}, {url: 'f', status: 'unreviewed', fit: null, kit: true},
    {url: 'g', status: 'unreviewed', fit: 97},
  ];
  assert.deepEqual(apply.pick(jobs, 3).map(j => j.url), ['c', 'd', 'a']);  // g: best fit, but no kit yet
});

test('agent sessions need Notion; Chrome opens the chosen jobs', async () => {
  const storage = tempStorage();
  const spawned = [];
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, ...args]); return {unref() {}}; };
  const blocked = await apply.start(storage, {n: 2, mode: 'agents'}, fakeSpawn);
  assert.equal(blocked.ok, false);
  assert.equal(spawned.length, 0);
});

test('Chrome mode marks each job link so the extension fills every tab by itself', {skip: process.platform === 'win32' && 'Mac launcher (open -a, Terminal); Windows is covered below'}, async () => {
  const storage = tempStorage();
  const spawned = [];
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, ...args]); return {unref() {}}; };
  const fakeList = async () => ({jobs: [
    {url: 'https://job-boards.greenhouse.io/a/jobs/1#top', status: 'unreviewed', fit: 80, title: 'SRE', company: 'A', kit: true},
    {url: 'https://jobs.lever.co/b/2', status: 'saved', fit: 60, title: 'DevOps', company: 'B', kit: true}]});
  const result = await apply.start(storage, {n: 2, mode: 'chrome'}, fakeSpawn, fakeList);
  assert.equal(result.ok, true);
  assert.deepEqual(spawned[0], ['open', '-a', 'Google Chrome', 'https://jobs.lever.co/b/2#jobpilotto-fill',
    'https://job-boards.greenhouse.io/a/jobs/1#jobpilotto-fill']);
});

test('an Apply batch drafts the missing kits for the best jobs first, quietly, and says so', {skip: process.platform === 'win32' && 'Mac launcher'}, async () => {
  const storage = tempStorage();
  const spawned = [];
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, ...args]); return {unref() {}}; };
  const jobs = [{code: 'a', url: 'https://a/1', status: 'unreviewed', fit: 90, title: 'SRE', company: 'A', kit: true},
    {code: 'b', url: 'https://b/2', status: 'unreviewed', fit: 85, title: 'Ops', company: 'B'},
    {code: 'c', url: 'https://c/3', status: 'unreviewed', fit: 70, title: 'Dev', company: 'C'}];
  const prepared = [];
  const prepare = async code => { prepared.push(code); jobs.find(job => job.code === code).kit = true; return {ok: true}; };
  const result = await apply.start(storage, {n: 2, mode: 'chrome'}, fakeSpawn, async () => ({jobs}), undefined, undefined, prepare);
  assert.deepEqual(prepared, ['b']);  // only the shortfall, best fit first
  assert.match(result.message, /^Drafted 1 kit first\. Opened 2 job/);
  assert.equal(spawned[0].length, 3 + 2);
});

test('an Apply batch does not wait for kits drafted on GitHub, and says so', async () => {
  const jobs = [{code: 'b', url: 'https://b/2', status: 'unreviewed', fit: 85, title: 'Ops', company: 'B'}];
  const result = await apply.start(tempStorage(), {n: 1, mode: 'chrome'}, () => ({unref() {}}), async () => ({jobs}), undefined, undefined, async () => ({ok: true, cloud: true}));
  assert.equal(result.ok, false);
  assert.match(result.error, /GitHub/);
});

test('missing kits are picked saved first, then by fit, open jobs only', () => {
  const jobs = [{code: 'a', url: 'u', status: 'unreviewed', fit: 90}, {code: 'b', url: 'u', status: 'saved', fit: 50}, {code: 'c', url: 'u', status: 'applied', fit: 99},
    {code: 'd', url: 'u', status: 'unreviewed', fit: 95, kit: true}];
  assert.deepEqual(apply.pickMissing(jobs, 5).map(job => job.code), ['b', 'a']);
});

test('Tailor CVs for top matches: open jobs without a tailored CV, saved first, then by fit, capped', () => {
  const jobs = [{code: 'a', url: 'u', status: 'unreviewed', fit: 90}, {code: 'b', url: 'u', status: 'saved', fit: 50, tailored: true}, {code: 'c', url: 'u', status: 'saved', fit: 40},
    {code: 'd', url: 'u', status: 'dismissed', fit: 99}, {code: 'e', url: 'u', status: 'unreviewed', fit: 95}];
  assert.deepEqual(apply.pickUntailored(jobs, 5).map(job => job.code), ['c', 'e', 'a']);
  assert.deepEqual(apply.pickUntailored(jobs, 2).map(job => job.code), ['c', 'e']);
});

test('strategy draft: CV as a PDF document, structured output; only the search settings cache is saved on the Mac', async () => {
  const storage = tempStorage();
  pipeline.ensureConfig(storage);
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  const reply = {
    summary: 'Set up for SRE roles in Zurich.', profile_markdown: '# Hard constraints\n- EU citizen',
    answers_markdown: '# Eligibility\n- No sponsorship', open_questions: ['Salary in EUR?'],
    search: {role_keywords: ['site reliability'], title_exclude_keywords: ['intern'], board_discovery_keywords: ['devops'],
      jobs_board_search_queries: ['site reliability engineer'], quality_stack_keywords: ['kubernetes'],
      locations: {top_tier: ['z[uü]rich'], country_wide: ['switzerland'], abroad: []}, remote_excluded_regions: ['\\busa?\\b'],
      google_jobs: {queries: ['sre'], country: 'ch', locations: [{location: 'Zurich,Zurich,Switzerland', language: 'de'}]}},
    preferences: {disqualifying_languages: ['German'], excluded_companies: ['Acme']},
  };
  const seen = [];
  const client = {messages: {create: async request => {
    seen.push(request);
    return {stop_reason: 'end_turn', usage: {input_tokens: 10000, output_tokens: 3000}, content: [{type: 'text', text: JSON.stringify(reply)}]};
  }}};
  const result = await strategy.draft(storage, {roles: 'SRE'}, 'sk-ant-x', client);
  assert.equal(result.usd, 0.05);
  assert.equal(seen[0].model, 'claude-sonnet-5-5');
  assert.equal(seen[0].messages[0].content[0].type, 'document');
  assert.equal(seen[0].output_config.format.type, 'json_schema');
  strategy.save(storage, result);
  assert.equal(storage.readText('profile.md'), '');  // the Profile goes to Notion, not the Mac
  const search = JSON.parse(storage.readText('config/search.json'));
  assert.deepEqual(search.role_keywords, ['site reliability']);
  assert.equal(search.google_jobs.searches_per_run, 1);
  const preferences = JSON.parse(storage.readText('config/preferences.json'));
  assert.deepEqual(preferences.excluded_companies, ['Acme']);
  assert.equal(preferences.digest_min_score, 50);
});

test('the pipeline never inherits the developer\'s tokens or .env', () => {
  const storage = tempStorage();
  const env = pipeline.pipelineEnv(storage, {PATH: '/usr/bin', HOME: '/Users/x', NOTION_TOKEN: 'owner', SERPAPI_API_KEY: 'owner',
    GITHUB_TOKEN: 'owner', JOB_PILOTTO_ENRICH_MODEL: 'x', TELEGRAM_CHAT_ID: '1'});
  assert.equal(env.PATH, '/usr/bin');
  for (const leaked of ['NOTION_TOKEN', 'SERPAPI_API_KEY', 'GITHUB_TOKEN', 'JOB_PILOTTO_ENRICH_MODEL', 'TELEGRAM_CHAT_ID']) {
    assert.equal(env[leaked], undefined, leaked);
  }
  assert.equal(env.JOB_PILOTTO_NO_DOTENV, '1');
});

test('the user\'s own Adzuna and Jooble keys reach the engine, and a developer\'s never do', () => {
  const storage = tempStorage();
  storage.setSecret('ADZUNA_APP_ID', 'id1');
  storage.setSecret('ADZUNA_APP_KEY', 'key1');
  storage.setSecret('JOOBLE_API_KEY', 'jk1');
  const env = pipeline.pipelineEnv(storage, {PATH: '/usr/bin', ADZUNA_APP_ID: 'owner'});
  assert.deepEqual([env.ADZUNA_APP_ID, env.ADZUNA_APP_KEY, env.JOOBLE_API_KEY], ['id1', 'key1', 'jk1']);
  assert.equal(pipeline.pipelineEnv(tempStorage(), {PATH: '/usr/bin', ADZUNA_APP_ID: 'owner'}).ADZUNA_APP_ID, undefined);
});

test('the end-to-end journey\'s fixture feeds and its fictional candidate reach the engine; nothing else of the shell does', () => {
  const env = pipeline.pipelineEnv(tempStorage(), {PATH: '/usr/bin', JOB_PILOTTO_FIXTURE_DIR: '/fx', JOB_PILOTTO_LOCATIONS_FILE: '/fx/person.json', JOB_PILOTTO_EXCLUDED_COMPANIES: 'Acme'});
  assert.equal(env.JOB_PILOTTO_FIXTURE_DIR, '/fx');
  assert.equal(env.JOB_PILOTTO_LOCATIONS_FILE, '/fx/person.json');   // dropped before, so the scout judged feeds for the example Amsterdam analyst, not the test candidate
  assert.equal(env.JOB_PILOTTO_EXCLUDED_COMPANIES, undefined);
});

test('with Notion connected, the Profile comes from Notion, not the local file', () => {
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_APPLICATIONS_DB: 'abc'}});
  const env = pipeline.pipelineEnv(storage, {PATH: '/usr/bin'});
  assert.equal(env.JOB_PILOTTO_PROFILE_FILE, undefined);
  assert.equal(env.NOTION_TOKEN, 'ntn_x');
  assert.equal(env.NOTION_APPLICATIONS_DB, 'abc');
});

test('pasted keys lose copy artefacts; look-alike letters from another layout are named, not sent', () => {
  assert.deepEqual(cleanSecret(' sk-ant-api03-abc\u200b\n'), {value: 'sk-ant-api03-abc'});
  const {value, error} = cleanSecret('sk-ant-api03-frp802\u0415\u0435hN');
  assert.equal(value, undefined);
  assert.match(error, /Character 20 \("\u0415", U\+0415\)/);
});

test('strategy draft streams: progress names the part being written and grows to 100 only at the end', async () => {
  const storage = tempStorage();
  pipeline.ensureConfig(storage);
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  const text = JSON.stringify({summary: 'S'.repeat(120), profile_markdown: 'P'.repeat(400), answers_markdown: 'A'.repeat(300), open_questions: [],
    search: {role_keywords: [], title_exclude_keywords: [], board_discovery_keywords: [], jobs_board_search_queries: [],
      quality_stack_keywords: [], locations: {top_tier: [], country_wide: [], abroad: []}, remote_excluded_regions: [],
      google_jobs: {queries: [], country: 'ch', locations: []}}, preferences: {disqualifying_languages: [], excluded_companies: []}});
  const client = {messages: {stream: () => {
    const handlers = [];
    return {
      on: (event, handler) => { if (event === 'text') handlers.push(handler); },
      finalMessage: async () => {
        for (let end = 50; end < text.length; end += 50) handlers.forEach(h => h('', text.slice(0, end)));
        return {stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text}]};
      },
    };
  }}};
  const seen = [];
  await strategy.draft(storage, {}, 'sk-ant-x', client, p => seen.push(p));
  const parts = [...new Set(seen.map(p => p.part))];
  assert.deepEqual(parts.slice(0, 3), ['Writing the summary', 'Writing your Profile', 'Writing your standard answers']);
  assert.ok(seen.every((p, i) => i === 0 || p.percent >= seen[i - 1].percent));
  assert.ok(seen.every(p => p.percent <= 99));
  assert.equal(storage.settings().draftSections.profile_markdown, strategy.sectionLengths(text).profile_markdown);  // the next draft's bar
});

test('draft progress: 10% once Claude starts writing, then each part by its share, in order', () => {
  assert.deepEqual(strategy.progress('', {}), {part: 'Reading your CV', percent: 0, chars: 0, notes: []});
  const summary = '{"summary":"' + 'x'.repeat(400) + '",';
  assert.equal(strategy.progress(summary, {}).percent, 13);  // reading 10 + summary 3
  assert.equal(strategy.progress(summary + '"profile_markdown":"' + 'y'.repeat(7480), {}).percent, 33);  // + half of the Profile's 40
  const typical = {profile_markdown: 7500};  // this user's Profile is usually shorter: learned from the last draft
  assert.equal(strategy.progress(summary + '"profile_markdown":"' + 'y'.repeat(7480), typical).percent, 51);  // a part being written stops at 95% of its share
  assert.equal(strategy.progress('{"summary":"x","profile_markdown":"y","answers_markdown":"z', {}).part, 'Writing your standard answers');
  // A short Profile that's finished counts in full once the answers start (it used to count by length: bar ended ~45%).
  assert.equal(strategy.progress(summary + '"profile_markdown":"' + 'y'.repeat(3000) + '","answers_markdown":"', {}).percent, 53);
  const done = summary + '"goals":{"seniority":"Senior"},"profile_markdown":"y","answers_markdown":"z","open_questions":[],"search":{},"preferences":{},"contact":{"email":"a"';
  assert.ok(strategy.progress(done, {}).percent >= 97);
  assert.ok(strategy.progress(summary + '"profile_markdown":"' + 'y'.repeat(99999) + '","answers_markdown":"' + 'z'.repeat(99999)
    + '","open_questions":[],"search":{' + 'q'.repeat(9999) + '},"preferences":{' + 'p'.repeat(999) + '},"contact":{' + 'c'.repeat(999), {}).percent <= 99);
});

test('setup asks no questionnaire: the AI proposes the goals from the CV, the optional note wins', async () => {
  const storage = tempStorage();
  pipeline.ensureConfig(storage);
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  assert.deepEqual(strategy.DRAFT_SCHEMA.properties.goals.required, ['seniority', 'work_mode', 'minimum_salary', 'languages']);
  assert.ok(strategy.DRAFT_SCHEMA.required.includes('goals'));
  const seen = [];
  const client = {messages: {create: async request => { seen.push(request); return {stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: '{}'}]}; }}};
  await strategy.draft(storage, {anything_else: 'Remote only, please'}, 'sk-ant-x', client);
  await strategy.draft(storage, {}, 'sk-ant-x', client);
  assert.match(seen[0].messages[0].content[1].text, /<note_from_user>\nRemote only, please\n<\/note_from_user>/);
  assert.match(seen[1].messages[0].content[1].text, /propose everything from the CV/);
  assert.doesNotMatch(seen[1].messages[0].content[1].text, /questionnaire/);
  assert.match(seen[0].system, /propose what they are looking for from the CV/);
  const text = '{"summary":"x","goals":{"seniority":"Senior","work_mode":"Remote only","minimum_salary":"CHF 130,000 (estimate)","languages":"English"},"profile_markdown":"';
  assert.ok(strategy.notes(text).includes('Proposed goals: Senior · Remote only · CHF 130,000 (estimate) · English'));
  assert.equal(strategy.progress(text).part, 'Writing your Profile');
});

test('the note to the AI is kept in the drafted Profile (What I told the AI), replaced on a regenerated draft', async () => {
  const storage = tempStorage();
  pipeline.ensureConfig(storage);
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  const reply = JSON.stringify({summary: 'x', profile_markdown: '# Hard constraints\n\n| Work mode | Remote |\n'});
  const client = {messages: {create: async () => ({stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: reply}]})}};
  const drafted = await strategy.draft(storage, {anything_else: 'Staff level, permanent only\nCompanies under 500 people'}, 'sk-ant-x', client);
  assert.equal(drafted.profile_markdown, '# Hard constraints\n\n| Work mode | Remote |\n\n# What I told the AI\n\nStaff level, permanent only\nCompanies under 500 people\n');
  assert.equal((await strategy.draft(storage, {}, 'sk-ant-x', client)).profile_markdown, '# Hard constraints\n\n| Work mode | Remote |\n');
  // A regenerated draft (or one that already has the section) keeps one section, with the new note; later sections stay.
  const again = strategy.withNote(`${drafted.profile_markdown}\n# Confirmed during setup\n\n- Senior\n`, {anything_else: 'Remote only'});
  assert.equal(again.match(/# What I told the AI/g).length, 1);
  assert.match(again, /- Senior\n\n# What I told the AI\n\nRemote only\n$/);
  assert.match(again, /# Confirmed during setup\n\n- Senior/);
  assert.doesNotMatch(again, /Staff level/);
  assert.doesNotMatch(strategy.withNote(drafted.profile_markdown, {}), /What I told the AI/);
});

test('a goal corrected in the review lands in the drafted Profile (its row, else a Confirmed during setup section)', async () => {
  const {applyGoal} = await import('../renderer/markdown-edit.js');
  const md = '# Hard constraints\n\n| Constraint | Value |\n|---|---|\n| Work mode | Hybrid |\n| Minimum seniority | Senior |\n\n# Compensation\n\n- Target: x\n- Minimum acceptable: CHF 1 (estimate)\n';
  let out = applyGoal(md, 'work_mode', 'Remote only');
  assert.match(out, /\| Work mode \| Remote only \|/);
  out = applyGoal(out, 'seniority', 'Staff');
  assert.match(out, /\| Minimum seniority \| Staff \|/);
  out = applyGoal(out, 'minimum_salary', 'CHF 150,000');
  assert.match(out, /- Minimum acceptable: CHF 150,000\n/);
  out = applyGoal(out, 'languages', 'English');
  out = applyGoal(out, 'languages', 'English, German');
  assert.match(out, /# Confirmed during setup\n\n- Languages I can work in: English, German\n$/);
  assert.equal(out.match(/Languages I can work in/g).length, 1);
});

test('demo mode has a fictional draft with proposed goals (the setup review renders without AI)', () => {
  const demo = JSON.parse(fs.readFileSync(new URL('../demo/draft.json', import.meta.url), 'utf8'));
  for (const key of strategy.DRAFT_SCHEMA.required) assert.ok(key in demo.draft, key);
  assert.deepEqual(Object.keys(demo.draft.goals), strategy.DRAFT_SCHEMA.properties.goals.required);
});

test('Apply on one job opens it in Chrome with the fill marker; no link, no Chrome', {skip: process.platform === 'win32' && 'Mac launcher (open -a, Terminal); Windows is covered below'}, () => {
  const calls = [];
  const open = (...args) => { calls.push(args); return {unref() {}}; };
  assert.deepEqual(apply.openOne('https://jobs.lever.co/acme/1#top', open), {ok: true});
  assert.deepEqual(calls[0].slice(0, 2), ['open', ['-a', 'Google Chrome', 'https://jobs.lever.co/acme/1#jobpilotto-fill']]);
  assert.equal(apply.openOne('', open).ok, false);
  assert.equal(calls.length, 1);
});

test('the extension gets the base CV from the app; contact details and notes need Notion', async () => {
  const storage = tempStorage();
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  storage.saveSettings({cvName: 'CV_Ada.pdf'});
  const server = await import('../lib/server.js');
  const me = await server.me(storage);
  assert.deepEqual(me.contact, {});  // without Notion there is nowhere to read them from
  assert.match(me.contactError, /Notion/);  // and it says why, instead of an empty answer that looks like "no details"
  assert.equal(me.contactSource, 'none');
  assert.equal(me.resume.name, 'CV_Ada.pdf');
  assert.equal(Buffer.from(me.resume.data, 'base64').toString(), '%PDF-1.4 fake');
  assert.ok(strategy.DRAFT_SCHEMA.required.includes('contact'));
});

test('the window scripts parse (a syntax error leaves the app window blank)', async () => {
  const {execFileSync} = await import('node:child_process');
  const {readdirSync} = await import('node:fs');
  const pages = readdirSync(new URL('../renderer/pages/', import.meta.url)).map(file => `renderer/pages/${file}`);
  for (const file of ['renderer/app.js', ...pages, 'preload.cjs', 'main.js', 'start.js']) {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`../${file}`, import.meta.url))]);
  }
});

test('open questions are the ❓ lines of the Notion standard answers; answering fills the line in place', async () => {
  const questions = await import('../lib/questions.js');
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_ANSWERS_PAGE_ID: 'answers'}});
  const {blocks, fetcher} = fakeNotion(['Notice period: ❓', 'Salary expectation: CHF 130,000']);
  const run = {url: 'https://x/1', trace: [
    {label: 'Are you open to relocation?', required: true, reason: questions.NO_ANSWER},
    {label: 'Nickname', required: false, reason: questions.NO_ANSWER},
    {label: 'Salary expectation', required: true, reason: questions.NO_ANSWER},  // the page already has it
    {label: 'Email', required: true, reason: ''}]};
  assert.equal(await questions.collect(storage, run, 'Acme', fetcher), 1);
  assert.equal(await questions.collect(storage, run, 'Acme', fetcher), 0);  // already on the page
  assert.equal(blocks.at(-1).text, 'Are you open to relocation?: ❓ (asked by Acme)');
  const open = await questions.list(storage, fetcher);
  assert.deepEqual(open.map(q => [q.question, q.company]), [['Notice period', ''], ['Are you open to relocation?', 'Acme']]);
  assert.deepEqual(await questions.answer(storage, open[1].key, 'Yes, within Switzerland', fetcher), {ok: true});
  assert.equal(blocks.at(-1).text, 'Are you open to relocation?: Yes, within Switzerland');
  assert.deepEqual(await questions.answer(storage, open[0].key, '', fetcher), {ok: true});  // skip = line removed
  assert.deepEqual(blocks.map(b => b.text), ['Salary expectation: CHF 130,000', 'Are you open to relocation?: Yes, within Switzerland']);
  assert.equal((await questions.list(storage, fetcher)).length, 0);
  assert.equal(storage.settings().openQuestions, undefined);  // nothing kept on the Mac
});

test('a form\'s required marker (*) is not part of an open question', async () => {
  const questions = await import('../lib/questions.js');
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_ANSWERS_PAGE_ID: 'answers'}});
  const {blocks, fetcher} = fakeNotion(['* Street, No.: ❓ (asked by Acme)']);
  const run = {url: 'https://x/1', trace: [{label: '* Nationality', required: true, reason: questions.NO_ANSWER},
    {label: 'Street, No. *', required: true, reason: questions.NO_ANSWER}]};  // same question as the page's: not added again
  assert.equal(await questions.collect(storage, run, 'Acme', fetcher), 1);
  assert.equal(blocks.at(-1).text, 'Nationality: ❓ (asked by Acme)');
  assert.deepEqual((await questions.list(storage, fetcher)).map(q => q.question), ['Street, No.', 'Nationality']);
});

test('contact fields left empty never become questions for the answers page (they come from the Profile)', async () => {
  // 29 Sep 2026: a Canonical fill whose contact details didn't load added "First Name: ❓", "Last Name: ❓", "Email: ❓".
  const questions = await import('../lib/questions.js');
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_ANSWERS_PAGE_ID: 'answers'}});
  const {blocks, fetcher} = fakeNotion([]);
  const empty = label => ({label, required: true, reason: questions.NO_ANSWER});
  const run = {url: 'https://x/1', trace: ['First Name', 'Last Name *', 'Email', 'Phone', 'LinkedIn Profile', 'Location (City)',
    'How did you perform in mathematics at high school?'].map(empty)};
  assert.equal(await questions.collect(storage, run, 'Canonical', fetcher), 1);
  assert.deepEqual(blocks.map(b => b.text), ['How did you perform in mathematics at high school?: ❓ (asked by Canonical)']);
});

test('without Notion, open questions say so instead of keeping a copy on the Mac', async () => {
  const questions = await import('../lib/questions.js');
  const storage = tempStorage();
  const run = {url: 'https://x/1', trace: [{label: 'Are you open to relocation?', required: true, reason: questions.NO_ANSWER}]};
  await assert.rejects(questions.collect(storage, run, 'Acme'), /Connect Notion first/);
  await assert.rejects(questions.list(storage), /Connect Notion first/);
  assert.equal(storage.settings().openQuestions, undefined);
});

test('form knowledge: learned notes merge per site and field, and read as prompt text', async () => {
  const learn = await import('../lib/learn.js');
  let notes = learn.merge([], [{scope: 'job-boards.greenhouse.io', field: 'Preferred First Name', kind: 'answer', value: 'Igor', note: 'Same as first name'}]);
  notes = learn.merge(notes, [{scope: 'job-boards.greenhouse.io', field: 'preferred first name', kind: 'answer', value: 'Igor', note: 'Use first name'}]);
  assert.equal(notes.length, 1);
  assert.match(learn.asText(notes), /Preferred First Name|preferred first name/);
  const client = {messages: {create: async request => {
    assert.match(request.system, /Never invent personal facts/);
    return {usage: {input_tokens: 1000, output_tokens: 100}, content: [{type: 'text', text: JSON.stringify({notes: [
      {scope: 'any', field: 'Pronouns', kind: 'answer', value: 'Prefer not to say', note: 'From the standard answers'}]})}]};
  }}};
  const result = await learn.learn({run: {url: 'https://x.io/a', trace: [{label: 'Pronouns', outcome: 'left', reason: 'no answer'}]}, client, apiKey: 'x'});
  assert.equal(result.notes.length, 1);
  const nothing = await learn.learn({run: {url: 'https://x.io/a', trace: [{label: 'Email', outcome: 'filled'}]}, client, apiKey: 'x'});
  assert.equal(nothing.notes.length, 0);  // nothing left: no AI call
});

test('form knowledge is per site: fields already studied there are not sent to the AI again', async () => {
  const learn = await import('../lib/learn.js');
  const run = {url: 'https://job-boards.greenhouse.io/twilio/jobs/1', trace: [
    {label: 'Pronouns', outcome: 'left', reason: 'no answer'}, {label: 'Consent', outcome: 'left', reason: 'legal/consent: always your choice'}]};
  assert.equal(learn.newFields(run).length, 1);
  assert.equal(learn.newFields(run, {'job-boards.greenhouse.io': ['pronouns']}).length, 0);  // studied on this site
  assert.equal(learn.newFields({...run, url: 'https://jobs.lever.co/x/1'}, {'job-boards.greenhouse.io': ['pronouns']}).length, 1);
  assert.equal(learn.newFields(run, {}, [{scope: 'any', field: 'Pronouns'}]).length, 0);  // a note already covers it
});

test('fill reports: mechanical failures only, form structure only, each site + field once, off with technical reports', async () => {
  const reports = await import('../lib/reports.js');
  const storage = tempStorage();
  const run = {url: 'https://job-boards.greenhouse.io/x/jobs/1', debug: {version: '0.6.2', form: [{label: 'Location (City)', type: 'combobox', options: ['Geneva']}],
    answers: [{field: 'loc', value: 'Geneva, Switzerland'}]},
    trace: [{label: 'Location (City)', required: true, reason: 'dropdown clicked, but no option matched (1.5 s)'},
      {label: 'Pronouns', reason: 'no answer in the kit, Profile or your details'}]};
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true}; };
  storage.saveSettings({telemetry: false});
  assert.equal(await reports.send(storage, run, fetcher), null);  // technical reports turned off
  storage.saveSettings({telemetry: true});
  const report = await reports.send(storage, run, fetcher);
  assert.equal(report.fields.length, 1);
  assert.equal(report.fields[0].reason, 'dropdown clicked, but no option matched');  // the click's time dropped
  assert.deepEqual(report.fields[0].options, ['Geneva']);
  assert.ok(!JSON.stringify(sent).includes('Geneva, Switzerland'));  // no answers
  assert.equal(await reports.send(storage, run, fetcher), null);  // already reported for this site
  // A field reported before snapshots existed is reported once more with its snapshot (for its issue), then never.
  const snapshot = {t: 'div', a: {class: 'select__container'}, c: [{t: 'input', a: {role: 'combobox', 'data-jp-field': ''}, c: []}]};
  const withSnapshot = {...run, snapshots: {'Location (City)': snapshot}};
  const again = await reports.send(storage, withSnapshot, fetcher);
  assert.deepEqual(again.fields[0].snapshot, snapshot);
  assert.equal(await reports.send(storage, withSnapshot, fetcher), null);
});

test('Apply with Claude needs Claude Code, Notion and the job\'s kit, then starts one session for the job', async () => {
  const storage = tempStorage();
  const launched = [];
  const launch = async (_, urls, options) => { launched.push([urls, options]); return urls.length; };
  const found = () => '/usr/local/bin/claude';
  const kit = async () => ({ok: true});
  const url = 'https://www.jobs.ch/en/vacancies/detail/1/';
  assert.match((await apply.claudeOne(storage, url, launch, () => '', kit)).error, /Claude Code/);
  assert.match((await apply.claudeOne(storage, url, launch, found, kit)).error, /Notion/);
  storage.setSecret('NOTION_TOKEN', 'ntn_test');
  assert.equal((await apply.claudeOne(storage, '', launch, found, kit)).ok, false);
  assert.match((await apply.claudeOne(storage, url, launch, found, async () => ({ok: false, error: 'No application kit'}))).error, /kit/);
  assert.equal(launched.length, 0);
  assert.deepEqual(await apply.claudeOne(storage, `${url}#top`, launch, found, kit), {ok: true});
  assert.deepEqual(launched[0][0], [url]);
  assert.equal(launched[0][1].claude, '/usr/local/bin/claude');
  assert.equal(typeof launched[0][1].open, 'function');  // the form tab opens (with the fill mark) before Claude starts
  assert.match(apply.claudeReady(storage, found, 'win32', () => '').error, /Git for Windows/);
  assert.equal(apply.claudeReady(storage, found, 'win32', () => 'C:\\Git\\bin\\bash.exe').ok, true);
});

test('Apply to N with Claude: the best N jobs with a kit, one session each; none says so', async () => {
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_test');
  const launched = [];
  const launch = async (_, urls) => { launched.push(urls); };
  const two = async () => ['https://a/1', 'https://b/2'];
  const binary = apply.claudeBinary() ? null : 'skip';
  if (binary) return;  // no Claude Code on this machine: claudeReady stops first
  const result = await apply.start(storage, {n: 3, mode: 'agents'}, null, null, launch, two);
  assert.equal(result.ok, true);
  assert.deepEqual(launched[0], ['https://a/1', 'https://b/2']);
  assert.match(result.message, /Starting 2 Claude/);
  assert.match((await apply.start(storage, {n: 3, mode: 'agents'}, null, null, launch, async () => [])).error, /no application kit|application kit yet/i);
});

test('the next jobs with a kit come from apply_batch --next, links only', async () => {
  const run = async (_, args) => ({code: 0, stdout: `Loading…\r\n{"url": "https://a/1", "title": "SRE", "company": "Acme"}\r\nhttps://b/2\n`, args});
  const urls = await apply.nextWithKits({}, 2, run);
  assert.deepEqual([...urls], ['https://a/1', 'https://b/2']);
  assert.deepEqual(urls.details['https://a/1'], {title: 'SRE', company: 'Acme'});  // for the session card and notification
  assert.deepEqual([...await apply.nextWithKits({}, 2, async () => ({code: 1, stdout: 'https://a/1'}))], []);
});

test('the kit check asks Notion through apply_batch --has-kit and says how to draft one when there is none', async () => {
  const seen = [];
  const run = async (_, args, onLine) => { seen.push(args); onLine('No Applications row for x — prepare a kit first (📝 Prepare).'); return {code: 1}; };
  const result = await apply.hasKit({}, 'https://x', run);
  assert.deepEqual(seen[0], ['src.ai.apply_batch', '--has-kit', 'https://x']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Prepare only/);
  assert.deepEqual(await apply.hasKit({}, 'https://x', async () => ({code: 0})), {ok: true});
});

test('claude is found outside the shell PATH, where the installer puts it', () => {
  const found = apply.claudeBinary({PATH: '/usr/bin'}, file => file === '/opt/homebrew/bin/claude', 'darwin');
  assert.equal(found, '/opt/homebrew/bin/claude');
  assert.equal(apply.claudeBinary({PATH: ''}, () => false, 'darwin'), '');
});

test('the Jobs filter finds a job by its pasted link, however it was copied', async () => {
  const {matches, looksLikeLink} = await import('../renderer/filter.js');
  const job = {title: 'Site Reliability Engineer (a)', company: 'KMS AG', location: 'Kriens',
    url: 'https://www.jobs.ch/en/vacancies/detail/236ae744-8fa8-464d-b4ae-a9e3a9b9c8bd/'};
  for (const pasted of ['www.jobs.ch/en/vacancies/detail/236ae744-8fa8-464d-b4ae-a9e3a9b9c8bd',
    'https://www.jobs.ch/en/vacancies/detail/236ae744-8fa8-464d-b4ae-a9e3a9b9c8bd/?utm_source=x#apply',
    'jobs.ch/en/vacancies/detail/236ae744-8fa8-464d-b4ae-a9e3a9b9c8bd/']) {
    assert.ok(looksLikeLink(pasted), pasted);
    assert.ok(matches(job, pasted), pasted);
  }
  assert.ok(!matches(job, 'www.jobs.ch/en/vacancies/detail/other-job'));
  assert.ok(matches(job, 'kms'));
  assert.ok(matches(job, '236ae744'));  // part of the link, typed as a word
  assert.ok(!looksLikeLink('site reliability'));
  assert.ok(matches(job, ''));
});

test('Apply with Claude tickets: one job, three hours, unknown ones refused', async () => {
  const server = await import('../lib/server.js');
  const now = Date.parse('2026-09-28T10:00:00Z');
  const ticket = server.issueTicket('https://boards.greenhouse.io/acme/jobs/1#jobpilotto-fill', now);
  assert.match(ticket, /^[0-9a-f]{32}$/);
  assert.equal(server.checkTicket(ticket, 'https://boards.greenhouse.io/acme/jobs/1/', now + 1000), true);
  assert.equal(server.checkTicket(ticket, 'https://boards.greenhouse.io/acme/jobs/2', now), false);
  assert.equal(server.checkTicket(ticket, 'https://boards.greenhouse.io/acme/jobs/1', now + 3 * 3600 * 1000 + 1), false);
  assert.equal(server.checkTicket('guess', 'https://boards.greenhouse.io/acme/jobs/1', now), false);
});

test('Windows: Chrome is chrome.exe itself (no shell), the bundled Python is python.exe, claude may be claude.cmd', () => {
  const env = {ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local'};
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  assert.deepEqual(apply.chromeCommand(['https://x/?a=1&b=2'], 'win32', env, file => file === chrome), [chrome, ['https://x/?a=1&b=2']]);
  assert.equal(apply.chromeCommand(['https://x'], 'win32', env, () => false), null);
  assert.deepEqual(apply.chromeCommand(['https://x'], 'darwin', {}, () => false), ['open', ['-a', 'Google Chrome', 'https://x']]);
  // Edge: used when it is the browser with the extension, or the only one installed; Chrome wins otherwise.
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const both = file => file === chrome || file === edge;
  const pc = {...env, 'ProgramFiles(x86)': 'C:\\Program Files (x86)'};
  assert.deepEqual(apply.chromeCommand(['https://x'], 'win32', pc, file => file === edge), [edge, ['https://x']]);
  assert.deepEqual(apply.chromeCommand(['https://x'], 'win32', pc, both), [chrome, ['https://x']]);
  assert.deepEqual(apply.chromeCommand(['https://x'], 'win32', pc, both, 'Microsoft Edge'), [edge, ['https://x']]);
  assert.deepEqual(apply.chromeCommand(['https://x'], 'darwin', {}, file => file === '/Applications/Microsoft Edge.app'), ['open', ['-a', 'Microsoft Edge', 'https://x']]);
  assert.equal(apply.extensionBrowser(() => [{app: 'Google Chrome', enabled: false}, {app: 'Microsoft Edge', enabled: true}]), 'Microsoft Edge');
  assert.equal(apply.extensionBrowser(() => []), '');
  // The e2e stand-in, only with the e2e flag (a user's JOB_PILOTTO_E2E_OPENER alone does nothing).
  assert.deepEqual(apply.chromeCommand(['https://x'], 'win32', {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_OPENER: 'C:\\o.mjs'}), ['node', ['C:\\o.mjs', 'https://x']]);
  assert.deepEqual(apply.chromeCommand(['https://x'], 'darwin', {JOB_PILOTTO_E2E_OPENER: '/o.mjs'}, () => false), ['open', ['-a', 'Google Chrome', 'https://x']]);
  assert.match(pipeline.python('win32', file => file.endsWith('python.exe')), /python[\\/]python\.exe$/);
  assert.equal(pipeline.python('win32', () => false), 'python');
  const npm = 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd';
  assert.equal(apply.claudeBinary({PATH: 'C:\\Windows;C:\\Tools', USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming'},
    file => file === npm, 'win32'), npm);
  assert.match(apply.claudeReady({}, () => npm, 'win32', () => '').error, /Git for Windows/);
});

test('Windows wording: the PC, File Explorer, Ctrl, its own encryption; the Mac keeps its words', async () => {
  const {osText, pick} = await import('../renderer/os.js');
  assert.equal(osText("Keys are encrypted with your Mac's Keychain and never leave this Mac.", 'win32'),
    "Keys are encrypted with Windows' built-in encryption and never leave this PC.");
  assert.equal(osText('Runs on GitHub, even when your Mac is off.', 'win32'), 'Runs on GitHub, even when your PC is off.');
  assert.equal(osText('Show in Finder', 'win32'), 'Show in File Explorer');
  assert.equal(osText('Recordings in Finder', 'win32'), 'Recordings in File Explorer');
  assert.equal(osText('(⌘-click: in a window)', 'win32'), '(Ctrl-click: in a window)');
  assert.equal(osText('Show in Finder, this Mac', 'darwin'), 'Show in Finder, this Mac');
  // Every key the app names, including the ones the extension-install instructions show: a PC must never be told to
  // press ⌘, and two-key combinations are swapped before their second key alone.
  assert.equal(osText('chrome://extensions is on your clipboard: in Chrome press ⌘L, then ⌘V and ⏎.', 'win32'),
    'chrome://extensions is on your clipboard: in Chrome press Ctrl+L, then Ctrl+V and Enter.');
  assert.equal(osText('⌘K, ⌘R, ⌘⇧G, ⇧⌘G, ⌘G, ⇧Enter', 'win32'), 'Ctrl+K, Ctrl+R, Ctrl+Shift+G, Ctrl+Shift+G, Ctrl+G, Shift+Enter');
  assert.equal(osText('⌘K, ⌘R, ⌘⇧G, ⌘G', 'darwin'), '⌘K, ⌘R, ⌘⇧G, ⌘G');  // the Mac is left alone
  // The one instruction a swap can't fix: the PC's folder dialog has no "Go to Folder".
  assert.equal(pick('Load unpacked, then ⌘⇧G, ⌘V, Return.', 'Load unpacked, paste it (Ctrl+V), Enter.', 'win32'),
    'Load unpacked, paste it (Ctrl+V), Enter.');
  assert.equal(pick('Load unpacked, then ⌘⇧G, ⌘V, Return.', 'Load unpacked, paste it (Ctrl+V), Enter.', 'darwin'),
    'Load unpacked, then ⌘⇧G, ⌘V, Return.');
});

test('Apply with Claude checklist: Claude Code found and signed in, Git for Windows only on Windows', () => {
  const signedIn = apply.claudeSignedIn('/home/x', () => JSON.stringify({oauthAccount: {emailAddress: 'a@b.c'}}));
  assert.equal(signedIn, true);
  assert.equal(apply.claudeSignedIn('/home/x', () => { throw new Error('no file'); }), false);
  assert.deepEqual(apply.claudePrereqs('darwin', {binary: () => '/usr/local/bin/claude', signedIn: () => false, bash: () => '', chrome: () => true}),
    {claude: true, signedIn: false, git: null, windows: false, chrome: true});
  assert.equal(apply.claudePrereqs('win32', {binary: () => '', signedIn: () => true, bash: () => 'C:\\Program Files\\Git\\bin\\bash.exe'}).git, true);
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  assert.equal(apply.gitBash({ProgramFiles: 'C:\\Program Files'}, file => file === bash), bash);
  assert.equal(apply.gitBash({}, () => true), '');
});

test('every wizard step sits inside the wizard\'s content column (an extra </div> pushes the rest below the sidebar)', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const body = html.slice(html.indexOf('<div class="step-body">'), html.indexOf('<!-- After setup'));
  let depth = 0;
  for (const tag of body.matchAll(/<(\/?)div\b[^>]*>/g)) {
    depth += tag[1] ? -1 : 1;
    if (/data-step="/.test(tag[0])) assert.equal(depth, 2, `${tag[0]} opens outside .step-body`);
  }
  assert.equal(depth, 0, 'the wizard\'s divs are balanced');
});

test('every Settings card is closed before the next one starts (an unclosed card nests the rest inside it)', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('<div class="view" data-view="settings"');
  const view = html.slice(start, html.indexOf('</main>', start));
  let depth = 0, page = null;  // cards sit directly inside a Settings sub-page (Overview, Connections…)
  for (const tag of view.matchAll(/<(\/?)div\b[^>]*>/g)) {
    depth += tag[1] ? -1 : 1;
    if (/class="settings-page"/.test(tag[0])) page = depth;
    if (/class="setting[ "]/.test(tag[0])) assert.equal(depth, page + 1, `${tag[0]} is nested inside another card`);
  }
  assert.equal(depth, 0, 'the Settings view\'s divs are balanced');
});

test('while the strategy is drafted, the screen lists what Claude has finished so far', async () => {
  const {notes} = await import('../lib/strategy.js');
  const full = JSON.stringify({summary: 'Senior SRE roles in Zurich.', profile_markdown: '# Hard constraints\n- EU citizen\n# Compensation\n- CHF 150k',
    answers_markdown: '# Eligibility\n- No sponsorship', open_questions: ['Notice period?'],
    search: {role_keywords: ['site reliability', '\\bsre\\b'], locations: {top_tier: ['z[uü]rich'], country_wide: [], abroad: []}},
    preferences: {disqualifying_languages: ['German']}, contact: {email: 'a@b.c'}});
  const early = notes(full.slice(0, full.indexOf('"answers_markdown"') + 25));
  assert.deepEqual(early, ['Summary: Senior SRE roles in Zurich.', 'Profile: Hard constraints', 'Profile: Compensation', 'Profile written']);
  const all = notes(full);
  for (const line of ['Standard answers: Eligibility', 'Things for you to check: 1', 'Roles to look for: site reliability, sre',
    'Best places: zürich', 'Jobs requiring German will be hidden', 'Contact details found in your CV']) assert.ok(all.includes(line), line);
});

test('an edited cell or line goes back into its markdown line; the rest is untouched', async () => {
  const {replaceCell, replaceLine, withLine} = await import('../renderer/markdown-edit.js');
  assert.equal(replaceCell('| Pronouns | ❓ |', 1, 'he/him'), '| Pronouns | he/him |');
  assert.equal(replaceCell('| **School** | ❓ | x |', 1, 'Babeș-Bolyai | UBB\n'), '| **School** | Babeș-Bolyai / UBB | x |');
  assert.equal(replaceLine('  - Tone: direct', 'Tone: **direct**, factual'), '  - Tone: **direct**, factual');
  assert.equal(replaceLine('❓ Not provided', 'Decline to self-identify'), 'Decline to self-identify');
  assert.equal(withLine('# A\n| k | v |\n- x', 1, '| k | w |'), '# A\n| k | w |\n- x');
});

test('a Gmail check that exited normally but read nothing is a failure with its reason', async () => {
  const {mailProblem} = await import('../lib/pipeline.js');
  assert.equal(mailProblem('Cronjob run logged: https://x\nMail check skipped: the Anthropic API spend limit is reached (Error code: 400)'),
    'not checked: the Anthropic API spend limit was reached');
  assert.match(mailProblem('⚠️ The Google sign-in for Gmail and Calendar has expired (…)'), /Google sign-in expired/);
  assert.equal(mailProblem('Mail: 12 emails read, 2 updates\nUpdates:\nGrafana: Rejected'), null);
});

test('Rebuild from CV: changes grouped by what they trigger, contact edits ignored, location changes tie search and Profile', async () => {
  const {rebuildGroups, save} = await import('../lib/strategy.js');
  const current = {search: {role_keywords: ['\\bsre\\b'], locations: {top_tier: ['z[uü]rich']}}, preferences: {excluded_companies: ['Acme']},
    profile: '# Goals\n- SRE\n# Contact\n- Phone: 1', answers: '# Eligibility\n- EU citizen'};
  const draft = {search: {role_keywords: ['\\bsre\\b'], locations: {top_tier: ['z[uü]rich', 'basel']}}, preferences: {excluded_companies: ['Acme']},
    profile_markdown: '# Goals\n- SRE, platform\n# Contact\n- Phone: 2', answers_markdown: '# Eligibility\n- EU citizen'};
  const groups = rebuildGroups(current, draft, {scored: 120, kits: 5});
  assert.deepEqual(groups.map(group => group.id), ['search', 'profile']);  // no filter or answer changes; contact ignored
  assert.deepEqual(groups[0].changes, ['Top cities: +basel']);
  assert.equal(groups[0].linked, 'profile');
  assert.equal(groups[1].linked, 'search');
  assert.deepEqual(groups[1].changes, ['~ Goals']);
  assert.equal(groups[1].cost, '≈ $1.80');
  assert.match(groups[1].impact, /Re-scores 120 jobs over the next 2 searches; 5 unsent kits/);
  // A contact-only change isn't a Profile change for scoring.
  assert.deepEqual(rebuildGroups(current, {...draft, search: current.search, profile_markdown: '# Goals\n- SRE\n# Contact\n- Phone: 9'}), []);
  // Saving only the search criteria leaves the preferences file untouched.
  const storage = tempStorage();
  storage.writeText('config/search.json', '{"role_keywords":["old"]}');
  storage.writeText('config/preferences.json', '{"excluded_companies":["Keep"]}');
  save(storage, {search: {role_keywords: ['new']}, preferences: null});
  assert.deepEqual(JSON.parse(storage.readText('config/search.json')).role_keywords, ['new']);
  assert.deepEqual(JSON.parse(storage.readText('config/preferences.json')), {excluded_companies: ['Keep']});
});

test('the window is one module per page, and every import between them resolves', async () => {
  // Each page's state is declared in its own module, and every module is loaded before app.js runs any page's
  // start-up code, so a page can't use another's state too early. esbuild fails on an import nothing exports.
  const {build} = await import('esbuild');
  const result = await build({entryPoints: [fileURLToPath(new URL('../renderer/app.js', import.meta.url))], bundle: true,
    write: false, format: 'esm', platform: 'browser', external: ['../../node_modules/*'], logLevel: 'silent'});
  assert.equal(result.errors.length, 0);
  const {readdirSync} = await import('node:fs');
  const pages = readdirSync(new URL('../renderer/pages/', import.meta.url)).filter(file => file.endsWith('.js'));
  assert.ok(pages.length > 10 && pages.includes('shared.js'));
});

test('Claude in Chrome: found in any Chrome profile, false when Chrome or the extension is missing', async () => {
  const {claudeInChrome, CLAUDE_IN_CHROME} = await import('../lib/apply.js');
  const {join} = await import('node:path');  // the platform's separators (the Windows run uses backslashes)
  const fsTree = {'/c': ['Default', 'Profile 1', 'Local State'], [join('/c', 'Default', 'Extensions')]: ['abc'], [join('/c', 'Profile 1', 'Extensions')]: [CLAUDE_IN_CHROME]};
  const list = dir => { if (!fsTree[dir]) throw new Error('ENOENT'); return fsTree[dir]; };
  assert.equal(claudeInChrome('/c', list), true);
  assert.equal(claudeInChrome('/c', dir => (dir === '/c' ? ['Default'] : list(dir))), false);
  assert.equal(claudeInChrome('/missing', list), false);
});

test('Application sessions start collapsed: the pills say what needs you, and the head expands them', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const toggle = /id="sd-toggle"[^>]*aria-expanded="(\w+)"/.exec(html);
  assert.equal(toggle?.[1], 'false');  // what the window paints before any session exists (1 Oct 2026: the dock covered a third of the screen by default)
  const shared = fs.readFileSync(new URL('../renderer/pages/shared.js', import.meta.url), 'utf8');
  assert.match(shared, /dockOpen:\s*false/);  // and the state renderDock reads, so a reload doesn't open it again
});

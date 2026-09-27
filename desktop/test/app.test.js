import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
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
  assert.equal(env.JOB_PILOTTO_PROFILE_FILE, storage.path('profile.md'));
  assert.equal(env.JOB_PILOTTO_SCORE_MODEL, undefined);
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-x');
  env = pipeline.pipelineEnv(storage);
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-x');
  assert.equal(env.JOB_PILOTTO_SCORE_MODEL, 'claude-sonnet-5');
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

test('Chrome mode marks each job link so the extension fills every tab by itself', async () => {
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

test('strategy draft: CV as a PDF document, structured output, then saved into the user folder', async () => {
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
    preferences: {disqualifying_languages: ['German'], excluded_companies: ['Sonar']},
  };
  const seen = [];
  const client = {messages: {create: async request => {
    seen.push(request);
    return {stop_reason: 'end_turn', usage: {input_tokens: 10000, output_tokens: 3000}, content: [{type: 'text', text: JSON.stringify(reply)}]};
  }}};
  const result = await strategy.draft(storage, {roles: 'SRE'}, 'sk-ant-x', client);
  assert.equal(result.usd, 0.05);
  assert.equal(seen[0].model, 'claude-sonnet-5');
  assert.equal(seen[0].messages[0].content[0].type, 'document');
  assert.equal(seen[0].output_config.format.type, 'json_schema');
  strategy.save(storage, result);
  assert.match(storage.readText('profile.md'), /EU citizen/);
  const search = JSON.parse(storage.readText('config/search.json'));
  assert.deepEqual(search.role_keywords, ['site reliability']);
  assert.equal(search.google_jobs.searches_per_run, 1);
  const preferences = JSON.parse(storage.readText('config/preferences.json'));
  assert.deepEqual(preferences.excluded_companies, ['Sonar']);
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
  assert.ok(seen.every(p => p.percent <= 97));
  assert.equal(storage.settings().draftChars, text.length);  // the next draft's estimate
});

test('draft progress: part from the latest field, percent against the expected length', () => {
  assert.deepEqual(strategy.progress('', 1000), {part: 'Reading your CV', percent: 0, chars: 0});
  assert.equal(strategy.progress('{"summary":"x","profile_markdown":"' + 'y'.repeat(460), 1000).percent, 50);
  assert.equal(strategy.progress('{"summary":"x","profile_markdown":"y","answers_markdown":"z', 1000).part, 'Writing your standard answers');
  assert.equal(strategy.progress('x'.repeat(5000), 1000).percent, 97);
});

test('Apply on one job opens it in Chrome with the fill marker; no link, no Chrome', () => {
  const calls = [];
  const open = (...args) => { calls.push(args); return {unref() {}}; };
  assert.deepEqual(apply.openOne('https://jobs.lever.co/acme/1#top', open), {ok: true});
  assert.deepEqual(calls[0].slice(0, 2), ['open', ['-a', 'Google Chrome', 'https://jobs.lever.co/acme/1#jobpilotto-fill']]);
  assert.equal(apply.openOne('', open).ok, false);
  assert.equal(calls.length, 1);
});

test('the strategy draft keeps the contact details it read from the CV; the extension gets them and the CV from the app', async () => {
  const storage = tempStorage();
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  storage.saveSettings({cvName: 'CV_Ada.pdf'});
  strategy.save(storage, {profile_markdown: 'P', answers_markdown: 'A', search: {google_jobs: {}}, preferences: {},
    contact: {first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com', phone: '', github: ''}});
  assert.deepEqual(storage.settings().contact, {first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com'});
  const server = await import('../lib/server.js');
  const me = server.me(storage);
  assert.equal(me.contact.email, 'ada@example.com');
  assert.equal(me.resume.name, 'CV_Ada.pdf');
  assert.equal(Buffer.from(me.resume.data, 'base64').toString(), '%PDF-1.4 fake');
  assert.ok(strategy.DRAFT_SCHEMA.required.includes('contact'));
});

test('the window scripts parse (a syntax error leaves the app window blank)', async () => {
  const {execFileSync} = await import('node:child_process');
  for (const file of ['renderer/app.js', 'preload.cjs', 'main.js']) {
    execFileSync(process.execPath, ['--check', new URL(`../${file}`, import.meta.url).pathname]);
  }
});

test('questions nothing could answer are collected once; answered ones are not asked again', async () => {
  const questions = await import('../lib/questions.js');
  const storage = tempStorage();
  const run = {url: 'https://x/1', trace: [
    {label: 'Are you open to relocation?', required: true, reason: questions.NO_ANSWER},
    {label: 'Nickname', required: false, reason: questions.NO_ANSWER},
    {label: 'Email', required: true, reason: ''}]};
  assert.equal(questions.collect(storage, run, 'Acme'), 1);
  assert.equal(questions.collect(storage, run, 'Acme'), 0);  // already open
  const [q] = storage.settings().openQuestions;
  assert.equal(q.company, 'Acme');
  questions.close(storage, q.key, true);
  assert.equal(storage.settings().openQuestions.length, 0);
  assert.equal(questions.collect(storage, run, 'Other'), 0);  // answered: not asked again
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

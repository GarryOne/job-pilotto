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
  assert.equal(env.JOB_PILOTTO_PROFILE_FILE, undefined);  // the Profile is read from Notion (required)
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
  assert.equal(storage.readText('profile.md'), '');  // the Profile goes to Notion, not the Mac
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
  const done = summary + '"profile_markdown":"y","answers_markdown":"z","open_questions":[],"search":{},"preferences":{},"contact":{"email":"a"';
  assert.ok(strategy.progress(done, {}).percent >= 97);
  assert.ok(strategy.progress(summary + '"profile_markdown":"' + 'y'.repeat(99999) + '","answers_markdown":"' + 'z'.repeat(99999)
    + '","open_questions":[],"search":{' + 'q'.repeat(9999) + '},"preferences":{' + 'p'.repeat(999) + '},"contact":{' + 'c'.repeat(999), {}).percent <= 99);
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
    trace: [{label: 'Location (City)', required: true, reason: 'dropdown clicked, but no option matched'},
      {label: 'Pronouns', reason: 'no answer in the kit, Profile or your details'}]};
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true}; };
  storage.saveSettings({telemetry: false});
  assert.equal(await reports.send(storage, run, fetcher), null);  // technical reports turned off
  storage.saveSettings({telemetry: true});
  const report = await reports.send(storage, run, fetcher);
  assert.equal(report.fields.length, 1);
  assert.deepEqual(report.fields[0].options, ['Geneva']);
  assert.ok(!JSON.stringify(sent).includes('Geneva, Switzerland'));  // no answers
  assert.equal(await reports.send(storage, run, fetcher), null);  // already reported for this site
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
  assert.deepEqual(launched[0], [[url], {claude: '/usr/local/bin/claude'}]);
  assert.match(apply.claudeReady(storage, found, 'win32', () => '').error, /Git for Windows/);
  assert.equal(apply.claudeReady(storage, found, 'win32', () => 'C:\\Git\\bin\\bash.exe').ok, true);
});

test('Apply to N with Claude: the best N jobs with a kit, one session each; none says Prepare', async () => {
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
  assert.match((await apply.start(storage, {n: 3, mode: 'agents'}, null, null, launch, async () => [])).error, /Prepare/);
});

test('the next jobs with a kit come from apply_batch --next, links only', async () => {
  const run = async (_, args) => ({code: 0, stdout: `Loading…\r\n{"url": "https://a/1", "title": "SRE", "company": "Acme"}\r\nhttps://b/2\n`, args});
  const urls = await apply.nextWithKits({}, 2, run);
  assert.deepEqual([...urls], ['https://a/1', 'https://b/2']);
  assert.deepEqual(urls.details['https://a/1'], {title: 'SRE', company: 'Acme'});  // for the session card and notification
  assert.deepEqual([...await apply.nextWithKits({}, 2, async () => ({code: 1, stdout: 'https://a/1'}))], []);
});

test('the kit check asks Notion through apply_batch --has-kit and says to Prepare when there is none', async () => {
  const seen = [];
  const run = async (_, args, onLine) => { seen.push(args); onLine('No Applications row for x — prepare a kit first (📝 Prepare).'); return {code: 1}; };
  const result = await apply.hasKit({}, 'https://x', run);
  assert.deepEqual(seen[0], ['src.ai.apply_batch', '--has-kit', 'https://x']);
  assert.equal(result.ok, false);
  assert.match(result.error, /press Prepare first/);
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
  assert.deepEqual(apply.chromeCommand(['https://x'], 'darwin'), ['open', ['-a', 'Google Chrome', 'https://x']]);
  assert.match(pipeline.python('win32', file => file.endsWith('python.exe')), /python[\\/]python\.exe$/);
  assert.equal(pipeline.python('win32', () => false), 'python');
  const npm = 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd';
  assert.equal(apply.claudeBinary({PATH: 'C:\\Windows;C:\\Tools', USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming'},
    file => file === npm, 'win32'), npm);
  assert.match(apply.claudeReady({}, () => npm, 'win32', () => '').error, /Git for Windows/);
});

test('Windows wording: the PC, File Explorer, Ctrl, its own encryption; the Mac keeps its words', async () => {
  const {osText} = await import('../renderer/os.js');
  assert.equal(osText("Keys are encrypted with your Mac's Keychain and never leave this Mac.", 'win32'),
    "Keys are encrypted with Windows' built-in encryption and never leave this PC.");
  assert.equal(osText('Runs on GitHub, even when your Mac is off.', 'win32'), 'Runs on GitHub, even when your PC is off.');
  assert.equal(osText('Show in Finder', 'win32'), 'Show in File Explorer');
  assert.equal(osText('Recordings in Finder', 'win32'), 'Recordings in File Explorer');
  assert.equal(osText('(⌘-click: in a window)', 'win32'), '(Ctrl-click: in a window)');
  assert.equal(osText('Show in Finder, this Mac', 'darwin'), 'Show in Finder, this Mac');
});

test('Apply with Claude checklist: Claude Code found and signed in, Git for Windows only on Windows', () => {
  const signedIn = apply.claudeSignedIn('/home/x', () => JSON.stringify({oauthAccount: {emailAddress: 'a@b.c'}}));
  assert.equal(signedIn, true);
  assert.equal(apply.claudeSignedIn('/home/x', () => { throw new Error('no file'); }), false);
  assert.deepEqual(apply.claudePrereqs('darwin', {binary: () => '/usr/local/bin/claude', signedIn: () => false, bash: () => ''}),
    {claude: true, signedIn: false, git: null, windows: false});
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
  const current = {search: {role_keywords: ['\\bsre\\b'], locations: {top_tier: ['z[uü]rich']}}, preferences: {excluded_companies: ['Sonar']},
    profile: '# Goals\n- SRE\n# Contact\n- Phone: 1', answers: '# Eligibility\n- EU citizen'};
  const draft = {search: {role_keywords: ['\\bsre\\b'], locations: {top_tier: ['z[uü]rich', 'basel']}}, preferences: {excluded_companies: ['Sonar']},
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

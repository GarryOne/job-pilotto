// The nightly smoke's logic (lib/smoke.mjs): how far a live run got, what counts as a regression, which posting is tried tonight.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compare, fieldLines, parseLive, pickPosting, placeFound, shortfall} from '../lib/smoke.mjs';

const LIVE = `  live 0s: Apply pressed on https://www.jobs.ch/en/vacancies/detail/x/
  2026-10-10T12:20:27Z [extension] page kind: account {"shape":"auth.jobs.ch/u/login/identifier|1-2","by":"ai"}
  2026-10-10T12:20:34Z [extension] fill: fields: 1 filled, 1 left {"fields":[]} account page
  2026-10-10T12:20:46Z [extension] account judgment result: needs_code {"botCheck":false}`;

test('a run that stopped at the email code reached code/bot; an account page\'s fields are not the form', () => {
  assert.deepEqual(parseLive(LIVE), {reached: 'code/bot', filled: null, left: null, fieldList: [], kinds: ['account'], path: [{kind: 'account', host: 'auth.jobs.ch'}], errors: []});
});

test('a form filled to the end is ready; one with fields left is form', () => {
  assert.equal(parseLive('Apply pressed on u\n[extension] page kind: form {}\n[extension] fill: fields: 9 filled, 0 left').reached, 'ready');
  assert.deepEqual(parseLive('Apply pressed on u\n[extension] fill: fields: 6 filled, 3 left').reached, 'form');
});

test('a regression: an earlier step than last time, or fewer fields on the same posting; a new shape is not one', () => {
  const before = {signin: {reached: 'code/bot', url: 'a'}, form: {reached: 'form', filled: 9, url: 'b'}};
  const now = {signin: {reached: 'posting', url: 'a'}, form: {reached: 'form', filled: 7, url: 'b'}, fresh: {reached: 'none', url: 'c'}};
  assert.deepEqual(compare(before, now).map(item => item.shape), ['signin', 'form']);
  assert.deepEqual(compare(before, {signin: {reached: 'form', url: 'a'}}), []);
});

test('postings rotate by day', () => {
  const day = n => new Date(n * 86400000);
  assert.deepEqual([pickPosting(['https://a.example/1', 'https://b.example/2', 'https://c.example/3'], day(0)), pickPosting(['https://a.example/1', 'https://b.example/2', 'https://c.example/3'], day(1))], ['https://a.example/1', 'https://b.example/2']);
  assert.deepEqual([pickPosting(['a', 'b', 'c'], day(0)), pickPosting(['a', 'b', 'c'], day(1)), pickPosting(['a', 'b', 'c'], day(3))], ['a', 'b', 'a']);
  assert.equal(pickPosting([]), null);
});

test('postings of a shape come read-only from the job list, quotes in a pattern cannot break the query', async () => {
  const {postingsLike} = await import('../smoke.mjs');
  let asked;
  const rows = postingsLike(["%jobs.ch%", "%o'brien%"], (cmd, args) => { asked = [cmd, args]; return 'https://www.jobs.ch/a\tEngineer\tAcme\nhttps://www.jobs.ch/b\tAnalyst\tBeta\n'; });
  assert.deepEqual(rows.map(row => row.url), ['https://www.jobs.ch/a', 'https://www.jobs.ch/b']);
  assert.equal(asked[0], 'sqlite3');
  assert.ok(asked[1].includes('-readonly'));
  assert.match(asked[1].at(-1), /like '%o''brien%'/);
});

test('a gone posting (404/410) is noted, and a note is never a regression', async () => {
  const {postingStatus} = await import('../smoke.mjs');
  assert.equal(await postingStatus('https://x.example/job', async () => ({status: 410})), 410);
  assert.equal(await postingStatus('https://x.example/job', async () => { throw new Error('offline'); }), 0);
  assert.deepEqual(compare({a: {reached: 'form', url: 'u'}}, {a: {reached: 'none', url: 'u', note: 'posting gone (HTTP 404)'}}), []);
});

test('the public site list holds only fixed job-feed postings: a profile\'s own jobs live in the app\'s folder, never in this repo', async () => {
  const fs = await import('node:fs');
  const {shapes} = JSON.parse(fs.readFileSync(new URL('../smoke-sites.json', import.meta.url), 'utf8'));
  assert.ok(shapes.length >= 5);
  for (const shape of shapes) { assert.equal(shape.like, undefined, `${shape.shape}: a job-list query belongs in the local list`); assert.ok(shape.urls?.length, shape.shape); }
  const {LOCAL_SITES} = await import('../smoke.mjs');
  assert.ok(!LOCAL_SITES.includes('/desktop/e2e/'), 'the local list is outside the repo');
  assert.ok(!/Job Pilotto\/smoke-sites/.test(LOCAL_SITES), 'and outside the app\'s folder, which a profile reset wipes');
});

test('rotation: 10 of 25 a night, every shape within 3 nights; a small pool runs whole', async () => {
  const {tonight} = await import('../lib/smoke.mjs');
  const pool = Array.from({length: 25}, (_, i) => `s${i}`), day = n => new Date(n * 86400000);
  const covered = new Set([0, 1, 2].flatMap(n => tonight(pool, 10, day(n))));
  assert.equal(tonight(pool, 10, day(0)).length, 10);
  assert.equal(covered.size, 25);
  assert.deepEqual(tonight(['a', 'b'], 10), ['a', 'b']);
});

test('each shape is compared with its own last run, however many nights ago', async () => {
  const {lastSeen} = await import('../lib/smoke.mjs');
  const seen = lastSeen([{day: '2026-10-01', results: {a: {reached: 'form'}, b: {reached: 'account'}}}, {day: '2026-10-05', results: {a: {reached: 'posting'}}}]);
  assert.deepEqual([seen.a.reached, seen.a.day, seen.b.reached, seen.b.day], ['posting', '2026-10-05', 'account', '2026-10-01']);
});

test('a flow signature: page kinds in order and the host the journey ended on; one signature per distinct flow', async () => {
  const {signature} = await import('../lib/smoke.mjs');
  const run = parseLive(`Apply pressed on u
  [extension] fill: page kind: posting {"by":"ai","host":"www.jobs.ch"}
  [extension] fill: page kind: posting {"by":"remembered","host":"www.jobs.ch"}
  [extension] fill: page kind: account {"by":"ai","host":"apply.deloitte.ch"}
  [extension] account judgment result: needs_code {"botCheck":false}`);
  assert.deepEqual(run.path, [{kind: 'posting', host: 'www.jobs.ch'}, {kind: 'account', host: 'apply.deloitte.ch'}]);
  assert.equal(signature(run), 'posting>account@apply.deloitte.ch#code/bot');
  assert.equal(signature({reached: 'none'}), 'unclear');
  assert.equal(signature({reached: 'posting', path: []}), 'unclear');
});

test('discovery candidates: a few per host, more from job boards, none already in the pool', async () => {
  const {candidates} = await import('../lib/smoke.mjs');
  const jobs = [...Array.from({length: 20}, (_, i) => ({url: `https://www.jobs.ch/en/vacancies/detail/${i}/`})), ...Array.from({length: 5}, (_, i) => ({url: `https://career.hm.com/job/${i}`}))];
  const picked = candidates(jobs, new Set(['https://career.hm.com/job/0']));
  assert.equal(picked.filter(item => item.url.includes('jobs.ch')).length, 12);
  assert.deepEqual(picked.filter(item => item.url.includes('hm.com')).map(item => item.url), ['https://career.hm.com/job/1', 'https://career.hm.com/job/2']);
});

test('never an automated visit to LinkedIn, Glassdoor, Indeed, levels.fyi or Reddit: not a discovery candidate, not a nightly pick', async () => {
  const {candidates, mayVisit} = await import('../lib/smoke.mjs');
  for (const url of ['https://ch.indeed.com/viewjob?jk=1', 'https://www.linkedin.com/jobs/view/1', 'https://www.glassdoor.ch/job/1', 'https://www.levels.fyi/jobs', 'https://www.reddit.com/r/jobs']) assert.equal(mayVisit(url), false, url);
  assert.equal(mayVisit('https://career.hm.com/job/1'), true);
  assert.deepEqual(candidates([{url: 'https://ch.indeed.com/viewjob?jk=1'}, {url: 'https://career.hm.com/job/1'}]).map(item => item.url), ['https://career.hm.com/job/1']);
  assert.equal(pickPosting([{url: 'https://ch.indeed.com/viewjob?jk=1'}]), null);
});

test('a discovered flow names the employer, and fills a never-run shape of the same host instead of adding a duplicate', () => {
  const shapes = [{shape: 'Richemont Workday', urls: ['https://richemont.wd3.myworkdayjobs.com/a']}, {shape: 'Known', urls: ['https://x.com/1'], signature: 'form@x.com#ready'}];
  placeFound(shapes, {url: 'https://richemont.wd3.myworkdayjobs.com/b', company: 'Richemont'}, 'posting@richemont.wd3.myworkdayjobs.com#posting', '2026-10-10');
  assert.equal(shapes.length, 2);
  assert.equal(shapes[0].signature, 'posting@richemont.wd3.myworkdayjobs.com#posting');
  placeFound(shapes, {url: 'https://jobs.ashbyhq.com/c/1', company: 'Acme'}, 'form@jobs.ashbyhq.com#form', '2026-10-10');
  assert.equal(shapes[2].shape, 'Acme (found 2026-10-10)');
  placeFound(shapes, {url: 'https://x.com/2'}, 'other@x.com#form', '2026-10-10');   // same host but already run: a new shape, named by host
  assert.equal(shapes[3].shape, 'x.com (found 2026-10-10)');
});

const FORM = `  live 0s: Apply pressed on https://jobs.example.com/o/x
  2026-10-10T19:21:09Z [extension] page kind: form {"by":"ai","host":"jobs.example.com"}
  2026-10-10T19:21:10Z [extension] fill: fields: 2 filled, 3 left {"fields":[{"label":"Full name","type":"text","outcome":"filled"
      field filled text "Full name" required=true reason=your details
      field filled email "Email address" required=true reason=your details
      field left text "How did you find out about us?" required=true reason=no answer known
      field left radio "Work permit" required=true reason=knockout question
      field left file "Cover letter" required=false reason=optional`;

test('a form run keeps each field with its outcome, requirement and reason (the line in the log is cut at 230 characters, so the runner prints them one per line)', () => {
  const result = parseLive(FORM);
  assert.equal(result.fieldList.length, 5);
  assert.deepEqual(result.fieldList[2], {outcome: 'left', type: 'text', label: 'How did you find out about us?', required: true, reason: 'no answer known'});
  assert.equal(result.fieldList[4].required, false);
});

test('a shortfall: the form was reached but fewer than half of the asked fields are filled (an optional field is not asked)', () => {
  assert.equal(shortfall(parseLive(FORM)), null);   // 2 of the 4 required fields (the optional cover letter is not asked): half is not a shortfall
  assert.deepEqual(shortfall(parseLive(FORM.replace('      field filled email', '      field left email'))), {done: 1, total: 4});   // 1 of 4
  assert.equal(shortfall({reached: 'form', filled: 4, left: 8}) && shortfall({reached: 'form', filled: 4, left: 8}).total, 12);   // counts only: 4 of 12
  assert.equal(shortfall({reached: 'form', filled: 6, left: 6}), null);   // half is not a shortfall
  assert.equal(shortfall({reached: 'posting', filled: null, left: null}), null);   // never reached the form: its own failure
  assert.equal(shortfall({reached: 'ready', filled: 5, left: 0}), null);
});

test('the fields line the app writes (far longer than 230 characters) becomes one line per field that parseLive reads back', () => {
  const fields = Array.from({length: 12}, (_, i) => ({label: `Question number ${i} about something long enough`, type: i % 2 ? 'radio' : 'text', outcome: i < 4 ? 'filled' : 'left', required: i !== 11, source: 'your details', reason: i < 4 ? '' : 'no answer known'}));
  const line = `2026-10-10T19:21:10.153Z [extension] fill: fields: 4 filled, 8 left ${JSON.stringify({fields})}`;
  assert.ok(line.length > 1000);
  const lines = fieldLines(line);
  assert.equal(lines.length, 12);
  const back = parseLive(['  live 0s: Apply pressed on https://x/', '  l [extension] page kind: form {"host":"x"}', '  l [extension] fill: fields: 4 filled, 8 left {"fields":[', ...lines].join('\n'));
  assert.equal(back.fieldList.length, 12);
  assert.equal(back.fieldList[11].required, false);
  assert.deepEqual(shortfall(back), {done: 4, total: 11});   // 4 of the 11 asked fields (the 12th is optional)
  assert.deepEqual(fieldLines('fill: fields: 1 filled, 1 left {"fields":[]} account page'), []);   // an account page's fields are not the form's
  assert.deepEqual(fieldLines('fill: fields: 4 filled, 8 left {"fields":[{"label":"Full name","type"'), []);   // a cut line gives none, never a wrong one
});

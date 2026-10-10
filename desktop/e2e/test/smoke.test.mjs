// The nightly smoke's logic (lib/smoke.mjs): how far a live run got, what counts as a regression, which posting is tried tonight.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compare, parseLive, pickPosting} from '../lib/smoke.mjs';

const LIVE = `  live 0s: Apply pressed on https://www.jobs.ch/en/vacancies/detail/x/
  2026-10-10T12:20:27Z [extension] page kind: account {"shape":"auth.jobs.ch/u/login/identifier|1-2","by":"ai"}
  2026-10-10T12:20:34Z [extension] fill: fields: 1 filled, 1 left {"fields":[]} account page
  2026-10-10T12:20:46Z [extension] account judgment result: needs_code {"botCheck":false}`;

test('a run that stopped at the email code reached code/bot; an account page\'s fields are not the form', () => {
  assert.deepEqual(parseLive(LIVE), {reached: 'code/bot', filled: null, left: null, kinds: ['account'], errors: []});
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

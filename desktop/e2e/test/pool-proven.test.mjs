// The "proven live" records CI sends (lib/pool-proven.mjs, lib/applying-report.mjs uploadProven) and the list for the coordinator (tools/unproven-fixes.mjs): one record per
// pool run that REALLY ran a row, only from CI, only through the narrow key; and one ready-to-dispatch line per fix that has none. The site joins them (site/src/applying-proven.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SITE_REFUSED} from '../lib/smoke.mjs';
import {recordsOf} from '../lib/pool-proven.mjs';
import {uploadProven} from '../lib/applying-report.mjs';
import {dispatchLines} from '../../../tools/unproven-fixes.mjs';

const ctx = {run: '38250000001', branch: 'main', pr: null, sha: 'abc1234def', subjects: [], at: '2026-10-12T13:00:00.000Z'};
const report = results => ({day: '2026-10-12', results, thisRun: {ran: Object.keys(results)}});

test('only a row that REALLY ran is a record: it reached a page; skipped, gone, refused, a bot wall, an unfinished or an AI-less row is none', () => {
  const ran = {reached: 'form', filled: 11, left: 7, url: 'https://x.example/a?b=1', applicant: 'grown'};
  const got = recordsOf(report({'Lever: single page, no account': ran, 'A': {reached: 'code/bot'}, 'B': {reached: 'posting', note: SITE_REFUSED}, 'C': {reached: 'none', note: 'posting gone (HTTP 404)'},
    'D': {reached: 'form', aiRefused: {calls: 2, why: 'x'}}, 'E': {reached: 'form', tripped: true}, 'F': {reached: 'posting', blocked: 'overlay'}}), ctx);
  assert.deepEqual(got, [{row: 'Lever: single page, no account', sha: 'abc1234def', branch: 'main', pr: null, subjects: [], reached: 'form', applicant: 'grown', run: '38250000001', at: '2026-10-12T13:00:00.000Z'}]);
  assert.equal(JSON.stringify(got).match(/https?:|\?b=1/), null, 'never an address');
  assert.deepEqual(recordsOf(report({}), ctx), []);
  const skippedOnly = {day: '2026-10-12', results: {X: {reached: 'form'}}, thisRun: {ran: []}};
  assert.deepEqual(recordsOf(skippedOnly, ctx), [], 'a row not in this run (another run\'s, in the day report) is none');
});

test('a PR run carries its PR number, its head sha and its commit subjects', () => {
  const pr = recordsOf(report({Lever: {reached: 'ready', filled: 18, left: 0}}), {...ctx, branch: 'fix-lever', pr: 458, sha: 'beef123', subjects: ['Fix the Lever upload slot', 'Add the case']});
  assert.deepEqual([pr[0].branch, pr[0].pr, pr[0].sha, pr[0].subjects, pr[0].applicant], ['fix-lever', 458, 'beef123', ['Fix the Lever upload slot', 'Add the case'], 'thin']);
});

const rows = [{row: 'Lever: single page, no account', sha: 'abc1234', branch: 'main', pr: null, subjects: [], reached: 'form', applicant: 'thin', run: '1', at: '2026-10-12T13:00:00.000Z'}];
const ci = {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'.repeat(40)};
test('the upload is for CI only, with the narrow key, to /applying/proven; never from a Mac, a control run or without the key; dry says it and sends nothing', async () => {
  const calls = [], fetcher = async (url, options) => { calls.push([url, options]); return {ok: true, json: async () => ({stored: 1})}; };
  assert.match(await uploadProven(rows, {env: ci, fetcher}), /proven report: 1 record\(s\) sent/);
  assert.equal(calls[0][0], 'https://www.jobpilotto.top/applying/proven');
  assert.equal(calls[0][1].headers.Authorization, `Bearer ${ci.REPLAYS_PUBLISH_KEY}`);
  assert.deepEqual(JSON.parse(calls[0][1].body).records, rows);
  for (const env of [{...ci, CI: ''}, {...ci, REAL_EXTENSION_DIR: '/x'}, {...ci, REPLAYS_PUBLISH_KEY: ''}]) assert.match(await uploadProven(rows, {env, fetcher}), /not sent/);
  assert.equal(calls.length, 1);
  assert.match(await uploadProven(rows, {env: {...ci, JP_PROVEN_DRY: '1'}, fetcher}), /dry run: would send 1/);
  assert.equal(calls.length, 1);
  assert.match(await uploadProven([], {env: ci, fetcher}), /nothing to send/);
  assert.match(await uploadProven(rows, {env: ci, fetcher: async () => { throw new Error('offline'); }}), /not sent \(offline\)/);
});

test('the list for the coordinator: one ready-to-dispatch line per fix that is not proven live, named by its pool row, newest first', () => {
  const fixed = [{site: 'Lever: single page, no account', commit: 'abc1234', landedAt: '2026-10-12T12:00:00Z', proven: null}, {site: 'Recruitee form', commit: 'def5678', landedAt: '2026-10-12T11:00:00Z', proven: {at: 'x', run: '9', by: 'main'}},
    {site: 'Join: form on join.com', commit: '0011223', landedAt: '2026-10-12T13:00:00Z', proven: null}];
  assert.deepEqual(dispatchLines(fixed), [
    "Join: form on join.com\t0011223\tgh workflow run record-sites.yml --ref main -f only='Join: form on join.com' -f share=1",
    "Lever: single page, no account\tabc1234\tgh workflow run record-sites.yml --ref main -f only='Lever: single page, no account' -f share=1"]);
  assert.deepEqual(dispatchLines([]), []);
  assert.deepEqual(dispatchLines([{site: "Odd 'name'", commit: 'a', landedAt: '2026-10-12T12:00:00Z', proven: null}]).map(line => line.split('\t')[2]), ["gh workflow run record-sites.yml --ref main -f only='Odd '\\''name'\\''' -f share=1"]);
});

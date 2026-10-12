// A PR's live proof is skipped, never red, when its row's site cannot be visited today (owner, 12 Oct 2026, via job-pilotto-cc: every PR check required; a NOT RUN for a
// reason outside the PR must not block a merge). lib/pool-proof-visit.mjs asks the run's own rule (lib/site-ledger.mjs guardLiveVisit, record: false) on CI's ledger of today.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {dayOf, markBlocked, siteOf} from '../lib/site-ledger.mjs';
import {planProof, rowUrl} from '../lib/pool-proof-visit.mjs';
import {summary} from '../lib/pool-ci.mjs';

const now = new Date('2026-10-12T15:00:00Z');
const ledger = () => ({JOB_PILOTTO_SITE_LEDGER_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-proof-ledger-')), JOB_PILOTTO_SITE_LIMIT: '2', JOB_PILOTTO_VISIT_KIND: 'proof'});
const URL1 = 'https://jobs.example-ats.test/acme/1234';
// A visit by another CI run today (the ledger counts one visit per process, so other runs' visits are written as their state hands them over: lib/pool-ci-state.mjs).
const visit = (env, kind) => {
  const file = path.join(env.JOB_PILOTTO_SITE_LEDGER_DIR, 'ledger.json'), data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  ((data[dayOf(now)] ||= {})[siteOf(URL1)] ||= {visits: []}).visits.push({at: now.getTime() - 3600000, run: `other-${kind}-${Math.random()}`, who: `CI run (${kind})`, kind});
  fs.writeFileSync(file, JSON.stringify(data));
};

test('a site with a visit left today: the proof runs; checking records nothing', () => {
  const env = ledger();
  assert.deepEqual(planProof({row: 'Acme form', url: URL1, env, now}), {row: 'Acme form', skipped: ''});
  assert.deepEqual(planProof({row: 'Acme form', url: URL1, env, now}), {row: 'Acme form', skipped: ''}, 'a check is not a visit');
  visit(env, 'hand');   // a by-hand run used one: the last is kept for a proof, so the proof still runs
  assert.equal(planProof({row: 'Acme form', url: URL1, env, now}).row, 'Acme form');
});

test('the site is out of visits today, or rests after a block page: no row (the proof job is SKIPPED), and the NOT RUN line says when to retry', () => {
  const env = ledger();
  visit(env, 'hand'); visit(env, 'proof');
  const full = planProof({row: 'Acme form', url: URL1, env, now});
  assert.equal(full.row, '');
  assert.match(full.skipped, /^NOT RUN: Acme form: the site limit \(jobs\.example-ats\.test: 2 live visits today \(limit 2\), the last at .*\), next visit possible after 2026-10-13 00:00 UTC$/);
  const rested = ledger();
  markBlocked(URL1, 'bot check', {env: rested, now});
  assert.match(planProof({row: 'Acme form', url: URL1, env: rested, now}).skipped, /it showed a block page at .* so it rests until tomorrow/);
});

test('no row picked, or a row with no public address: nothing to check, said as is', () => {
  assert.deepEqual(planProof({row: '', url: '', env: ledger(), now}), {row: '', skipped: ''});
  assert.deepEqual(planProof({row: 'Mac only', url: '', env: ledger(), now}), {row: 'Mac only', skipped: ''}, 'the run decides (it says NOT RUN itself)');
  assert.equal(rowUrl('Workday: an account inside the system, multi-step', {shapes: [{shape: 'Workday: an account inside the system, multi-step', urls: ['https://a.example/x']}]}), 'https://a.example/x');
  assert.equal(rowUrl('Nope', {shapes: []}), '');
});

test('a proof run that found no row it could visit is green (its comment says when to retry); a by-hand run that ran nothing stays red', () => {
  const report = {day: '2026-10-12', thisRun: {ran: [], skipped: [{shape: 'Acme form', why: 'site-ledger: jobs.example-ats.test is not visited: 2 live visits today (limit 2). Counted from'}]}, results: {}};
  const hand = summary(report, {now}), proof = summary(report, {now, proof: true});
  assert.ok(hand.notRun && proof.notRun, 'both say NOT RUN');
  assert.ok(hand.red.some(reason => reason.startsWith('NOT RUN')), 'by hand: red');
  assert.equal(proof.red.length, 0, 'a PR proof: not red (a reason outside the PR never blocks its merge)');
  assert.match(proof.markdown, /✅/);
});

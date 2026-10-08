// The live run (e2e/lib/apply-live.mjs) picks its posting without touching anything: LIVE_URL wins, else the newest match in the owner's job list, opened read-only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {livePosting} from '../e2e/lib/apply-live.mjs';

test('LIVE_URL names the posting; the company is its host unless told', () => {
  assert.deepEqual(livePosting({LIVE_URL: ' https://jobs.example.ch/a/1 '}), {url: 'https://jobs.example.ch/a/1', title: 'Live posting', company: 'jobs.example.ch', kit: []});
});

test('without LIVE_URL the job list is read read-only, newest match first', () => {
  let call = null;
  const posting = livePosting({LIVE_LIKE: '%coop%'}, (cmd, args) => { call = {cmd, args}; return 'Vendeuse\tCoop\thttps://jobs.coop.ch/x/1\n'; });
  assert.deepEqual(posting, {url: 'https://jobs.coop.ch/x/1', title: 'Vendeuse', company: 'Coop', kit: []});
  assert.equal(call.cmd, 'sqlite3');
  assert.equal(call.args[0], '-readonly');
  assert.match(call.args.at(-1), /order by jobs\.id desc limit 1/);
});

test('no match is a clear error, not an empty run', () => {
  assert.throws(() => livePosting({LIVE_LIKE: '%none%'}, () => ''), /LIVE_URL/);
});

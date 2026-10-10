// What leaves the Mac about controls: failures only, structure only, and other sites as a hash (lib/control-events.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {boardName, fromMisses, fromOperators, siteName} from '../lib/control-events.js';

test('job boards are named, any other site is a stable hash, the owner sees plain hosts', () => {
  assert.equal(siteName('job-boards.greenhouse.io'), 'job-boards.greenhouse.io');
  const hashed = siteName('api.easytemp.ch');
  assert.match(hashed, /^h:[0-9a-f]{10}$/);
  assert.equal(siteName('API.easytemp.ch'), hashed);   // the same site, however it is written
  assert.notEqual(siteName('another.example'), hashed);
  assert.equal(siteName('api.easytemp.ch', {owner: true}), 'api.easytemp.ch');
  assert.equal(siteName(''), '');
});

test('only failed operators with a real fingerprint become events, with no question or answer in them', () => {
  const events = fromOperators({host: 'jobs.ashbyhq.com', items: [
    {kind: 'toggle-group', fp: '1d2pcapx18', ok: false, why: 'the option did not stay selected', question: 'Salary 120000?', value: 'Igor'},
    {kind: 'toggle-group', fp: '1d2pcapx18', ok: true},
    {kind: 'date', fp: 'NOT VALID', ok: false, why: 'x'}]});
  assert.deepEqual(events, [{control: 'toggle-group', fp: '1d2pcapx18', outcome: 'failed', why: 'the option did not stay selected', site: 'jobs.ashbyhq.com'}]);
  assert.doesNotMatch(JSON.stringify(events), /Salary|Igor/);
});

test('only the controls that were new to this Mac are reported as missed', () => {
  const payload = {host: 'api.easytemp.ch', items: [{kind: 'switch', fingerprint: 'aaa111'}, {kind: 'radiogroup', fingerprint: 'bbb222'}]};
  const events = fromMisses(payload, new Set(['bbb222']));
  assert.deepEqual(events.map(e => [e.control, e.fp, e.outcome]), [['radiogroup', 'bbb222', 'missed']]);
  assert.match(events[0].site, /^h:/);
});

test('a board is named in short for the known ones, any other site is a hash', () => {
  assert.deepEqual(['job-boards.greenhouse.io', 'jobs.ashbyhq.com', 'jobs.lever.co', 'acme.recruitee.com'].map(boardName), ['greenhouse', 'ashby', 'lever', 'recruitee']);
  // Platforms the pool compares with real use (docs/superpowers/specs/2026-10-10-usage-weighted-pool.md): named, not hashed, so applications on them can be counted.
  assert.deepEqual(['acme.wd3.myworkdayjobs.com', 'career5.successfactors.eu', 'jobs.sapsf.com', 'join.com', 'acme.umantis.com'].map(boardName), ['workday', 'successfactors', 'successfactors', 'join', 'umantis']);
  assert.match(boardName('myjoin.com'), /^h:[0-9a-f]{10}$/, 'a look-alike host is not the platform');
  assert.match(boardName('api.easytemp.ch'), /^h:[0-9a-f]{10}$/);
  assert.equal(boardName(''), '');
});

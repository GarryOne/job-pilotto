// Technical reports (lib/telemetry.js): scrubbed before they leave the Mac, queued, sent in batches, off means off.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {create, event, scrub} from '../lib/telemetry.js';

test('nothing personal or secret leaves the Mac', () => {
  const text = scrub('Error at /Users/igor/Library/x.js for igor.m@gmail.com, key sk-ant-api03-abcdef, token ntn_12345678901234567890, '
    + 'call +41 79 123 45 67, see https://jobs.example.com/apply?email=a%40b.c&id=9#frag, bot 1234567890:AAabcdefghijklmnopqrstuvwxyz1234', 500, '/Users/igor');
  for (const leak of ['igor', 'gmail', 'sk-ant', 'ntn_', '79 123', 'email=', '#frag', 'AAabcdef']) assert.ok(!text.includes(leak), `${leak} in: ${text}`);
  assert.match(text, /~\/Library\/x\.js/);
  assert.match(text, /https:\/\/jobs\.example\.com\/apply/);  // the site stays: it's what a form issue is about
});

test('an event carries its fields scrubbed, and who/what/when without identity', () => {
  const item = event('run_failed', {job: 'prep', error: 'JSONDecodeError in /Users/igor/x', seconds: 73, cutOff: true},
    {install: 'id-1', version: '0.4.1', platform: 'darwin', osVersion: '25.3.0', now: Date.parse('2026-09-29T16:00:00Z')});
  assert.deepEqual([item.kind, item.install, item.version, item.seconds, item.cutOff], ['run_failed', 'id-1', '0.4.1', 73, true]);
  assert.ok(!item.error.includes('igor'));
});

function fakeStorage(settings = {}) {
  const files = {};
  return {settings: () => settings, saveSettings: next => Object.assign(settings, next), readText: name => files[name], writeText: (name, text) => { files[name] = text; }};
}

test('events queue on the Mac, go out in batches, and are removed once the server took them', async () => {
  const storage = fakeStorage();
  const posts = [];
  const telemetry = create(storage, {version: '0.4.1', fetcher: async (url, init) => { posts.push(JSON.parse(init.body).events.length); return {ok: true}; }});
  for (let i = 0; i < 60; i++) telemetry.record('crash', {message: `boom ${i}`});
  assert.equal(await telemetry.flush(), 60);
  assert.deepEqual(posts, [50, 10]);
  assert.equal(await telemetry.flush(), 0);  // nothing left
  assert.equal(telemetry.shown().length, 20);  // the last 20, for "See what's sent"
  assert.ok(storage.settings().telemetryId);  // a random install ID, made once
});

test('offline: kept for the next try; off: nothing recorded, the queue dropped', async () => {
  const storage = fakeStorage();
  const telemetry = create(storage, {version: '1', fetcher: async () => { throw new Error('offline'); }});
  telemetry.record('crash', {message: 'x'});
  assert.equal(await telemetry.flush(), 0);
  storage.saveSettings({telemetry: false});
  assert.equal(telemetry.record('crash', {message: 'y'}), null);
  let called = false;
  const off = create(storage, {version: '1', fetcher: async () => { called = true; return {ok: true}; }});
  assert.equal(await off.flush(), 0);
  assert.equal(called, false);
});

test('finished runs are counted per app version and taken (then reset) by the health line', () => {
  const storage = fakeStorage({telemetryRuns: {version: '0.4.0', ok: 9, failed: 9}});  // an older version's counts
  const telemetry = create(storage, {version: '0.4.1', fetcher: async () => ({ok: true})});
  telemetry.countRun(true); telemetry.countRun(true); telemetry.countRun(false);
  assert.deepEqual(telemetry.takeRuns(), {runsOk: 2, runsFailed: 1});
  assert.deepEqual(telemetry.takeRuns(), {runsOk: 0, runsFailed: 0});
  storage.settings().telemetry = false;
  telemetry.countRun(true);
  assert.deepEqual(telemetry.takeRuns(), {runsOk: 0, runsFailed: 0});
});

test('every report says which channel the install came from, once the installer left one (a label, shown in See what\'s sent)', async () => {
  const storage = fakeStorage();
  const sent = [];
  const telemetry = create(storage, {version: '0.4.2', fetcher: async (url, init) => { sent.push(...JSON.parse(init.body).events); return {ok: true}; }});
  telemetry.record('health', {});
  storage.saveSettings({installSource: 'reddit-devops'});
  telemetry.record('health', {});
  telemetry.record('health', {source: 'hn'});   // an event's own field is not overwritten
  await telemetry.flush();
  assert.deepEqual(sent.map(item => item.source), [undefined, 'reddit-devops', 'hn']);
});

test('a source run reports only when JOB_PILOTTO_TELEMETRY asks for it: "0" (the e2e harness) means no', async () => {
  const {sourceRunReports} = await import('../lib/telemetry.js');
  for (const off of [undefined, '', '0', 'off', 'OFF', 'false', 'no', ' 0 ']) assert.equal(sourceRunReports({JOB_PILOTTO_TELEMETRY: off}), false, `${off}`);
  for (const on of ['1', 'on', 'true', 'yes']) assert.equal(sourceRunReports({JOB_PILOTTO_TELEMETRY: on}), true, on);
  assert.equal(sourceRunReports({}), false);
});

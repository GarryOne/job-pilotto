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

// A reply's body is read the moment its headers arrive (lib/net-record.mjs): a page that navigates away right after a reply (a form built from the answer and submitted: SuccessFactors' Apply,
// POST /services/cas/createpayload/, 16 Oct 2026) has lost the body by the time the request is reported finished, and the old late read recorded an empty 200 that the replay served as the answer.
// A body that cannot be read is flagged (bodyLost), and the publish guard refuses such a row. Guard for lib/net-record.mjs and lib/record-guard.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {lostBodies} from '../lib/record-guard.mjs';
import {netRecorder} from '../lib/net-record.mjs';

// A browser context stand-in: a reply's body can be read until the page navigates away (Chromium drops it then).
function stubContext() {
  const handlers = {}, state = {navigated: false};
  const context = {on: (event, fn) => { (handlers[event] ||= []).push(fn); }, emit: (event, arg) => (handlers[event] || []).forEach(fn => fn(arg))};
  const make = (url, text) => {
    const response = {status: () => 200, allHeaders: async () => ({'content-type': 'application/json'}), headers: () => ({'content-type': 'application/json'}),
      body: async () => { if (state.navigated) throw new Error('No resource with given identifier found'); return Buffer.from(text); }};
    const request = {url: () => url, method: () => 'POST', resourceType: () => 'xhr', response: async () => response, allHeaders: async () => ({'sec-fetch-mode': 'cors'}), headers: () => ({}), postDataBuffer: () => Buffer.from('{}'), failure: () => null};
    response.request = () => request;
    return {request, response};
  };
  return {context, state, make};
}

test('a reply whose page navigates away right after it is still recorded with its body (read when its headers arrive)', async () => {
  const {context, state, make} = stubContext(), recorder = netRecorder(context, {startedAt: Date.now()});
  const {request, response} = make('https://site.example.test/services/cas/createpayload/', '{"payload":"abc"}');
  context.emit('request', request);
  context.emit('response', response);   // the headers arrive: the body is asked for now
  state.navigated = true;               // the page submits its form and leaves
  context.emit('requestfinished', request);
  await recorder.flush();
  const {entries, bodies} = recorder.result();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].size, 17);
  assert.ok(entries[0].hash && bodies.get(entries[0].hash).toString() === '{"payload":"abc"}');
  assert.equal(entries[0].bodyLost, undefined);
});

test('a body that really cannot be read is flagged, never recorded as a clean empty reply', async () => {
  const {context, state, make} = stubContext(), recorder = netRecorder(context, {startedAt: Date.now()});
  state.navigated = true;   // gone before anyone asked
  const {request, response} = make('https://site.example.test/services/other/', 'x');
  context.emit('request', request);
  context.emit('response', response);
  context.emit('requestfinished', request);
  await recorder.flush();
  const [entry] = recorder.result().entries;
  assert.deepEqual([entry.status, entry.hash, entry.size, entry.bodyLost], [200, '', 0, true]);
});

test('a record with a lost body is named by the publish guard (host and path only), a clean one is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-lost-body-'));
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: [{url: 'https://site.example.test/a?x=1', bodyLost: true}, {url: 'https://site.example.test/b'}]}));
  assert.deepEqual(lostBodies(dir), ['site.example.test/a']);
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: [{url: 'https://site.example.test/b'}]}));
  assert.deepEqual(lostBodies(dir), []);
  assert.deepEqual(lostBodies(path.join(dir, 'nothing')), []);
});

// One paid call per question at a time (8 Oct 2026 audit after the live twin sent "Localité" to Claude twice).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inFlight} from '../lib/in-flight.js';
import {keysFor} from '../lib/contact-keys.js';

test('an identical ask while the first runs shares its answer; another question, or a later ask, runs on its own', async () => {
  const once = inFlight();
  let calls = 0, release;
  const slow = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const a = once('cv1', slow), b = once('cv1', slow), c = once('cv2', async () => { calls++; return 'other'; });
  await new Promise(resolve => setTimeout(resolve, 5));
  release('answer');
  assert.deepEqual(await Promise.all([a, b, c]), ['answer', 'answer', 'other']);
  assert.equal(calls, 2);
  await once('cv1', async () => { calls++; return 'again'; });   // finished: a new ask runs
  assert.equal(calls, 3);
});

test('two pages asking which detail the same labels mean, at once, make one Claude call', async () => {
  const files = {}, storage = {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }};
  let sent = 0;
  const client = {messages: {create: async () => { sent++; await new Promise(resolve => setTimeout(resolve, 20));
    return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({items: [{label: 'localité', key: 'location'}]})}]}; }}};
  const [one, two] = await Promise.all([keysFor(storage, ['Localité'], {client}), keysFor(storage, ['Localité '], {client})]);
  assert.deepEqual([one, two], [{Localité: 'location'}, {'Localité ': 'location'}]);
  assert.equal(sent, 1);
});

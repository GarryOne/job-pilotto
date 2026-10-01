// Reject malformed session calls before side effects and validate real/demo response shapes without logging payloads.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {ContractError, assertSession, sessionContracts, sessionIpc, validateSessionCall, validateSessionResult} from '../lib/session-contracts.js';
import * as terminals from '../lib/terminals.js';
import {conversation} from '../lib/transcript.js';

const session = {id: 's1', url: 'https://example.com/job', company: 'Example', title: 'Engineer', status: 'input', note: '', startedAt: ''};

test('all session channels exposed by preload are contracted and registered through validation', () => {
  const preload = fs.readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const channels = [...preload.matchAll(/call\('(sessions\w*|session[A-Z]\w*)'\)/g)].map(match => match[1]);
  assert.deepEqual(channels.sort(), Object.keys(sessionContracts).sort());
  for (const name of channels) assert.ok(main.includes(`checkedSessions.handle('${name}'`), name);
});
test('invalid IDs, dimensions, arrays, and extra arguments fail before a handler runs; errors contain no values', async () => {
  const handlers = {}, logs = []; let calls = 0;
  const bridge = sessionIpc({handle: (name, callback) => { handlers[name] = callback; }}, (...args) => logs.push(args));
  for (const channel of ['sessionResize', 'sessionWrite', 'sessionsLeftOpen', 'sessions']) bridge.handle(channel, () => { calls++; });
  for (const [name, args] of [['sessionResize', ['secret-id', NaN, 32]], ['sessionResize', ['s', '120', 32]],
    ['sessionWrite', ['', 'private answer']], ['sessionsLeftOpen', [['s', 42]]], ['sessions', ['private answer']]]) {
    await assert.rejects(handlers[name]({}, ...args), error => error instanceof ContractError && !/private answer|secret-id/.test(error.message));
  }
  assert.equal(calls, 0); assert.equal(logs.length, 5); assert.ok(!JSON.stringify(logs).includes('secret-id'));
});
test('valid arguments reach async handlers unchanged, result violations fail, original failures propagate', async () => {
  const handlers = {}, bridge = sessionIpc({handle: (name, callback) => { handlers[name] = callback; }});
  bridge.handle('sessionOutput', async (_event, id) => { assert.equal(id, 's1'); return 'output'; });
  assert.equal(await handlers.sessionOutput({}, 's1'), 'output');
  bridge.handle('sessions', () => [{...session, status: 'invented'}]);
  await assert.rejects(handlers.sessions({}), /sessions response shape/);
  const failure = new Error('upstream failed'); bridge.handle('sessionStop', () => { throw failure; });
  await assert.rejects(handlers.sessionStop({}, 's1'), error => error === failure);
});
test('session field errors identify missing names, and known state/optional field types are enforced', () => {
  assert.equal(assertSession(session), session);
  assert.throws(() => assertSession({...session, id: undefined}), /response id/);
  assert.throws(() => assertSession({...session, live: 'yes'}), /response live/);
  assert.throws(() => assertSession({...session, status: 'applied'}), /response status/);
  assert.throws(() => validateSessionCall('sessionResize', ['s1', 1.5, 32]), /request argument 2/);
  assert.throws(() => validateSessionResult('sessionResume', {ok: 'yes'}), /response shape/);
  assert.throws(() => validateSessionResult('sessionResume', {ok: true, session: {...session, status: 'missing'}}), /response shape/);
});
test('demo sessions, transcript and terminal snapshots conform to the same renderer contracts', async () => {
  const demo = JSON.parse(fs.readFileSync(new URL('../demo/sessions.json', import.meta.url), 'utf8'));
  validateSessionResult('sessions', demo);
  validateSessionResult('sessionTranscript', conversation(new URL('../demo/transcript.jsonl', import.meta.url)));
  validateSessionResult('sessionSnapshot', await terminals.snapshotOf('hello'));
  validateSessionResult('sessionSnapshot', await terminals.snapshot('missing'));
  validateSessionResult('sessionSubmitted', null);
  validateSessionResult('sessionsLeftOpen', {choice: 'reset', kept: 0, reset: [], failed: []});
  validateSessionCall('sessionResize', ['s1', 120, 32]);
});

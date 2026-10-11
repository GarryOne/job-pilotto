// The page's AI questions go ahead of the app's side work (apply-latency change 1, owner 11 Oct 2026): the CLI slots (lib/ai/cli-base.js
// slots) serve a waiting 'page' ask first and keep one slot for it, and every AI route the extension asks while a form is open uses that lane.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {slots} from '../lib/ai/cli-base.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const later = () => { let open; const promise = new Promise(resolve => { open = resolve; }); return {promise, open}; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a page ask starts at once while side work holds both slots, on the one slot kept for it', async () => {
  const queue = slots(2), started = [];
  const side = [later(), later(), later()];
  side.forEach((gate, i) => queue(async () => { started.push(`side${i}`); await gate.promise; }));
  await tick();
  assert.deepEqual(started, ['side0', 'side1'], 'side work keeps to the two ordinary slots');
  const page = later();
  queue(async () => { started.push('page'); await page.promise; }, 'page');
  await tick();
  assert.deepEqual(started, ['side0', 'side1', 'page'], 'the page ask did not wait behind side work');
  const second = later();
  queue(async () => { started.push('page2'); await second.promise; }, 'page');
  await tick();
  assert.equal(started.includes('page2'), false, 'never more than the kept slot beyond the ordinary two');
  side[0].open(); await tick(); await tick();
  assert.deepEqual(started.slice(3), ['page2'], 'a freed slot goes to the waiting page ask before the waiting side work');
  page.open(); second.open(); side[1].open(); await tick(); await tick();
  assert.ok(started.includes('side2'), 'side work still runs once the page is served');
  side[2].open();
});

test('without page asks the side work keeps its two slots (nothing slower for a batch)', async () => {
  const queue = slots(2);
  let running = 0, most = 0;
  await Promise.all(Array.from({length: 6}, () => queue(async () => { running += 1; most = Math.max(most, running); await tick(); running -= 1; })));
  assert.equal(most, 2);
});

test('every AI route of the extension server asks in the page lane (a new route without it fails here)', () => {
  const pages = fs.readFileSync(path.join(here, '..', 'lib', 'server-pages.js'), 'utf8');
  const asks = pages.match(/aiClient\(storage[^)]*\)/g) || [];
  assert.ok(asks.length >= 7, `expected the 7 AI routes, found ${asks.length}`);
  for (const ask of asks) assert.match(ask, /lane: 'page'/, `${ask} in lib/server-pages.js is not in the page lane`);
  const env = fs.readFileSync(path.join(here, '..', 'lib', 'server-env.js'), 'utf8');
  assert.match(env, /get aiClient\(\) \{ return claudeCode\.client\(storage, \{lane: 'page'\}\)/, 'the form answers (server-env aiClient) are in the page lane');
});

test('the lane reaches the CLI queue through the adapter', async () => {
  const {ClaudeCode} = await import('../lib/ai/claude-code-cli.js');
  const seen = [];
  class Probe extends ClaudeCode { static queue = (work, lane) => { seen.push(lane); return work(); }; }
  const fake = () => {
    const child = {stdout: {on: (e, f) => e === 'data' && f(JSON.stringify({type: 'result', result: 'ok', usage: {}}))}, stderr: {on: () => {}},
      stdin: {on: () => {}, end: () => {}}, on: (e, f) => e === 'close' && setImmediate(() => f(0)), kill: () => {}};
    return child;
  };
  const run = (bin, args, opts, done) => done(null, '', '');
  for (const lane of ['page', undefined]) {
    await new Probe({binary: '/bin/true', spawnFn: fake, run, lane}).messages.create({model: 'claude-haiku-4-5', max_tokens: 10, messages: [{role: 'user', content: 'hi'}]});
  }
  assert.deepEqual(seen, ['page', undefined]);
});

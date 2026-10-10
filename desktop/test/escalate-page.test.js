// The picture rung for a job POSTING (lib/ladder/rung4-picture.js, scope "page"): the last look when the sketch, the digest and the person's own kept answer found no way to apply. It may only CLICK a
// control the page lists, that the AI judges to be an Apply control (control_kind) AND that passes the Apply floor; it never fills or chooses; off in "Let me check each step"; capped; remembered per shape.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {escalate, vetPage} from '../lib/ladder/rung4-picture.js';

const sketch = {url: 'https://jobs.example/post/4711', title: 'Pflegefachperson', headings: ['Pflegefachperson'], controls: [], buttons: ['Menü', 'Mitmachen', 'Teilen', 'Sign in with LinkedIn'], texts: [], frames: []};
const storageOf = (settings = {accountAutomation: 'full'}) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-esc-page-')); return {settings: () => settings, path: name => path.join(dir, name)}; };
const fake = (answer, seen = []) => ({messages: {create: async body => { seen.push(body); return {content: [{type: 'text', text: JSON.stringify(answer)}], stop_reason: 'end_turn'}; }}});
const ask = (extra = {}) => ({url: 'https://jobs.example/post/4711?token=SECRET', kind: 'page', sketch, image: '', reason: 'the ladder ended at the person', ...extra});
const click = (control, control_kind = 'apply') => ({action: 'click', control, control_kind, detail: '', option: '', why: 'x', confidence: 0.9});

test('a posting: a listed control the AI calls Apply goes through, from the sketch alone (no picture needed), and the model never sees the query string', async () => {
  const seen = [];
  const got = await escalate(storageOf(), ask(), {client: fake(click('mitmachen'), seen)});
  assert.deepEqual([got.action, got.control, got.by], ['click', 'Mitmachen', 'ai']);
  assert.ok(!JSON.stringify(seen[0]).includes('"type":"image"') && !JSON.stringify(seen[0]).includes('SECRET'));
  assert.match(JSON.stringify(seen[0]), /JOB POSTING/);
});

test('both keys must turn: the AI must call it Apply AND the Apply floor must accept it; a control the page does not list is never pressed', async () => {
  const run = (answer, url) => escalate(storageOf(), ask({url}), {client: fake(answer)});
  assert.equal((await run(click('Mitmachen', 'sign_in'), 'https://jobs.example/a')).action, 'ask_person', 'the AI says it signs in');
  assert.equal((await run(click('Mitmachen', 'third_party'), 'https://jobs.example/b')).action, 'ask_person');
  assert.equal((await run(click('Mitmachen', ''), 'https://jobs.example/c')).action, 'ask_person', 'no kind: not Apply');
  assert.equal((await run(click('Sign in with LinkedIn', 'apply'), 'https://jobs.example/d')).action, 'ask_person', 'the AI calls a LinkedIn sign-in Apply: the floor refuses it');
  const made = await run(click('Submit application'), 'https://jobs.example/e');
  assert.deepEqual([made.action, made.why], ['ask_person', 'the control is not on the page']);
});

test('a posting is never typed into or chosen from; wait is allowed; the person is asked for anything else', async () => {
  const run = (answer, url) => escalate(storageOf(), ask({url}), {client: fake(answer)});
  assert.equal((await run({action: 'fill', control: 'Mitmachen', control_kind: 'apply', detail: 'email', option: '', why: 'x', confidence: 0.9}, 'https://jobs.example/f')).action, 'ask_person');
  assert.equal((await run({action: 'choose', control: 'Mitmachen', control_kind: 'apply', detail: '', option: 'x', why: 'x', confidence: 0.9}, 'https://jobs.example/g')).action, 'ask_person');
  assert.equal((await run({action: 'wait', control: '', control_kind: '', detail: '', option: '', why: 'loading', confidence: 0.9}, 'https://jobs.example/h')).action, 'wait');
});

test('"Let me check each step" never looks at a posting; the cap and the memory are per shape and scope, and a click that worked is answered next time without the AI', async () => {
  const off = [];
  assert.deepEqual((await escalate(storageOf({accountAutomation: 'assist'}), ask(), {client: fake(click('Mitmachen'), off)})).why, 'off');
  assert.equal(off.length, 0);
  const storage = storageOf();
  await escalate(storage, ask(), {client: fake(click('Mitmachen'))});
  await escalate(storage, {url: 'https://jobs.example/post/4711', feedback: {kind: 'page', action: 'click', control: 'Mitmachen', worked: true}}, {});
  const seen = [];
  const again = await escalate(storage, ask(), {client: fake(click('Teilen'), seen)});
  assert.deepEqual([again.action, again.control, again.by, seen.length], ['click', 'Mitmachen', 'remembered', 0]);
  const account = await escalate(storage, ask({kind: 'account'}), {client: fake({action: 'wait', control: '', control_kind: '', detail: '', option: '', why: 'x', confidence: 1}, seen), });
  assert.notEqual(account.by, 'remembered', 'a posting\'s memory is not an account page\'s');
});

test('the pure check: vetPage keeps only a click, a wait, or the person', () => {
  const s = {...sketch, controls: [], buttons: ['Mitmachen', 'Teilen']};
  assert.equal(vetPage(click('Mitmachen'), s).action, 'click');
  assert.equal(vetPage(click('Teilen', 'other'), s).action, 'ask_person');
  assert.equal(vetPage({action: 'fill', control: 'x'}, s).action, 'ask_person');
  assert.equal(vetPage({action: 'wait'}, s).action, 'wait');
  assert.equal(vetPage(null, s).action, 'ask_person');
});

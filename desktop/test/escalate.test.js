// The closer look (lib/escalate.js): opt-in, account pages only, capped, a control only if the page lists it, remembered when it worked, a picture only of the right shape; no AI call otherwise.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {CAPS, escalate} from '../lib/escalate.js';

const sketch = {url: 'https://karriere.example/career', title: 'Anmelden', headings: [], controls: [{type: 'text', label: 'E-Mail', required: true, state: 'empty', at: '50,30'}], buttons: ['Anmelden', 'Noch kein Profil? Hier registrieren'], texts: [], frames: []};
const storageOf = (settings = {escalation: 'on'}) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-esc-')); return {settings: () => settings, path: name => path.join(dir, name)}; };
const fake = (answer, seen = []) => ({messages: {create: async body => { seen.push(body); return {content: [{type: 'text', text: JSON.stringify(answer)}], stop_reason: 'end_turn'}; }}});
const ask = (extra = {}) => ({url: 'https://karriere.example/career?token=SECRET', kind: 'account', sketch, image: Buffer.from('jpeg-bytes').toString('base64'), reason: 'unsure twice', ...extra});

test('off by default, and only on an account page: no AI call', async () => {
  const seen = [];
  assert.equal((await escalate(storageOf({}), ask(), {client: fake({action: 'wait', control: '', why: 'x', confidence: 1}, seen)})).why, 'off');
  assert.equal((await escalate(storageOf(), ask({kind: 'form'}), {client: fake({}, seen)})).why, 'account pages only');
  assert.equal(seen.length, 0);
});

test('a click on a control the page lists goes through; a made-up control becomes "ask the person"; the model got the picture and no query string', async () => {
  const seen = [];
  const good = await escalate(storageOf(), ask(), {client: fake({action: 'click', control: 'noch kein profil? hier registrieren', why: 'the register link', confidence: 0.9}, seen)});
  assert.deepEqual([good.action, good.control, good.by], ['click', 'Noch kein Profil? Hier registrieren', 'ai']);
  const sent = JSON.stringify(seen[0]);
  assert.ok(sent.includes('"type":"image"') && !sent.includes('SECRET'));
  const made = await escalate(storageOf(), ask(), {client: fake({action: 'click', control: 'Delete my account', why: 'x', confidence: 0.9})});
  assert.deepEqual([made.action, made.why], ['ask_person', 'the control is not on the page']);
});

test('assist means the person clicks; no picture, a huge picture or no AI is "none"', async () => {
  const assist = await escalate(storageOf({escalation: 'on', accountAutomation: 'assist'}), ask(), {client: fake({action: 'click', control: 'Anmelden', why: 'x', confidence: 0.9})});
  assert.equal(assist.action, 'ask_person');
  assert.equal((await escalate(storageOf(), ask({image: ''}), {client: fake({})})).why, 'no picture');
  assert.equal((await escalate(storageOf(), ask({image: 'A'.repeat(1_000_000)}), {client: fake({})})).why, 'no picture');
  assert.equal((await escalate(storageOf(), ask(), {client: null})).why, 'no AI');
});

test('two looks per page shape per day, ten a day; the count survives a restart', async () => {
  const storage = storageOf(), client = fake({action: 'wait', control: '', why: 'x', confidence: 1}), now = Date.parse('2026-10-08T12:00:00Z');
  for (let i = 0; i < CAPS.perShape; i++) assert.equal((await escalate(storage, ask(), {client, now})).action, 'wait');
  assert.equal((await escalate(storage, ask(), {client, now})).why, 'cap');
  assert.equal((await escalate(storage, ask({url: 'https://other.example/join'}), {client, now})).action, 'wait');   // another shape
  assert.equal((await escalate(storage, ask(), {client, now: now + 86400000})).action, 'wait');   // the next day
});

test('a click that moved the page on is remembered per page shape and answered next time without the AI', async () => {
  const storage = storageOf(), seen = [];
  await escalate(storage, {url: 'https://karriere.example/career', feedback: {action: 'click', control: 'Anmelden', worked: true}});
  const again = await escalate(storage, ask(), {client: fake({}, seen)});
  assert.deepEqual([again.action, again.control, again.by, seen.length], ['click', 'Anmelden', 'remembered', 0]);
  await escalate(storage, {url: 'https://other.example/x', feedback: {action: 'click', control: 'Anmelden', worked: false}});   // a click that did nothing is not kept
  assert.equal((await escalate(storage, ask({url: 'https://other.example/x'}), {client: fake({action: 'wait', control: '', why: 'x', confidence: 1})})).by, 'ai');
});

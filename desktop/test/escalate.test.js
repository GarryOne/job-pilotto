// The closer look (lib/escalate.js): opt-in, account pages only, capped, a control only if the page lists it, remembered when it worked, a picture only of the right shape; no AI call otherwise.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {CAPS, escalate} from '../lib/escalate.js';

const sketch = {url: 'https://karriere.example/career', title: 'Anmelden', headings: [], controls: [{type: 'text', label: 'E-Mail', required: true, state: 'empty', at: '50,30'}], buttons: ['Anmelden', 'Noch kein Profil? Hier registrieren'], texts: [], frames: []};
const storageOf = (settings = {escalation: 'on', accountAutomation: 'full'}) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-esc-')); return {settings: () => settings, path: name => path.join(dir, name)}; };
const fake = (answer, seen = []) => ({messages: {create: async body => { seen.push(body); return {content: [{type: 'text', text: JSON.stringify(answer)}], stop_reason: 'end_turn'}; }}});
const ask = (extra = {}) => ({url: 'https://karriere.example/career?token=SECRET', kind: 'account', sketch, image: Buffer.from('jpeg-bytes').toString('base64'), reason: 'unsure twice', ...extra});

test('off by default, and only on an account page: no AI call', async () => {
  const seen = [];
  assert.equal((await escalate(storageOf({}), ask(), {client: fake({action: 'wait', control: '', why: 'x', confidence: 1}, seen)})).why, 'off');
  assert.equal((await escalate(storageOf(), ask({kind: 'search'}), {client: fake({}, seen)})).why, 'account and application pages only');
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
  const unset = await escalate(storageOf({escalation: 'on'}), ask(), {client: fake({action: 'click', control: 'Anmelden', why: 'x', confidence: 0.9})});
  assert.equal(unset.action, 'ask_person');   // nothing saved = the default = assist (9 Oct 2026): the person clicks
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

// fill and choose (9 Oct 2026): the closer look's two hands besides a click, with the same floors.
const FORM = {...sketch, controls: [
  {type: 'text', label: 'E-Mail', required: true, state: 'empty', at: '50,30'},
  {type: 'password', label: 'Passwort', required: true, state: 'empty', at: '50,40'},
  {type: 'text', label: 'Vorname', required: true, state: 'filled', at: '50,50'},
  {type: 'select-one', label: 'Land', required: true, state: 'empty', at: '50,60', options: ['Bitte wählen', 'Schweiz', 'Deutschland']}]};
const looking = (answer, settings, seen) => escalate(storageOf(settings), ask({sketch: FORM}), {client: fake({control: '', detail: '', option: '', why: 'x', confidence: 0.9, ...answer}, seen)});

test('fill: only an empty text box the page lists, with a detail from the fixed list; never a password or a filled box', async () => {
  const good = await looking({action: 'fill', control: 'e-mail', detail: 'email'});
  assert.deepEqual([good.action, good.control, good.detail], ['fill', 'E-Mail', 'email']);
  assert.equal(good.value, undefined);   // the app adds the value later, from the person's details, never here
  for (const bad of [{control: 'Passwort', detail: 'email'}, {control: 'Vorname', detail: 'first_name'}, {control: 'Geheimes Feld', detail: 'email'}, {control: 'E-Mail', detail: 'password'}, {control: 'Land', detail: 'email'}]) {
    assert.equal((await looking({action: 'fill', ...bad})).action, 'ask_person', JSON.stringify(bad));
  }
});

test('choose: only a listed dropdown and one of its own options, in the page\'s own spelling', async () => {
  const good = await looking({action: 'choose', control: 'LAND', option: 'schweiz'});
  assert.deepEqual([good.action, good.control, good.option], ['choose', 'Land', 'Schweiz']);
  for (const bad of [{control: 'Land', option: 'Atlantis'}, {control: 'E-Mail', option: 'Schweiz'}, {control: 'Land', option: ''}]) {
    assert.equal((await looking({action: 'choose', ...bad})).action, 'ask_person', JSON.stringify(bad));
  }
});

test('assist: the person fills and chooses too; the model is shown the dropdown\'s options and never a value', async () => {
  const seen = [];
  assert.equal((await looking({action: 'fill', control: 'E-Mail', detail: 'email'}, {escalation: 'on', accountAutomation: 'assist'}, seen)).why, 'assist: the person fills it');
  assert.equal((await looking({action: 'choose', control: 'Land', option: 'Schweiz'}, {escalation: 'on', accountAutomation: 'assist'})).why, 'assist: the person chooses');
  assert.ok(JSON.stringify(seen[0]).includes('options: Bitte wählen | Schweiz | Deutschland'));
});

test('a fill that worked is remembered with its detail and replayed only while the box is still empty', async () => {
  const storage = storageOf();
  await escalate(storage, {url: 'https://karriere.example/career', feedback: {action: 'fill', control: 'E-Mail', detail: 'email', worked: true}});
  const again = await escalate(storage, ask({sketch: FORM}), {client: null});
  assert.deepEqual([again.action, again.control, again.detail, again.by], ['fill', 'E-Mail', 'email', 'remembered']);
  const filled = {...FORM, controls: FORM.controls.map(item => (item.label === 'E-Mail' ? {...item, state: 'filled'} : item))};
  assert.equal((await escalate(storage, ask({sketch: filled}), {client: null})).why, 'no AI');   // not empty any more: not replayed, back to asking
});

// 9 Oct 2026, Deloitte's CV step: an application page where the fill put nothing in is looked at again, from its sketch alone first, then with the picture.
const formSketch = {url: 'https://apply.example/Methods', title: 'My CV', headings: [], controls: [{type: 'textarea', label: 'Copy and paste CV', required: true, state: 'empty', at: '50,60'}], buttons: ['Upload CV', 'Copy and paste CV', 'Upload later', 'Continue'], texts: ['Choose from one of the options below'], frames: []};
const askForm = (extra = {}) => ({url: 'https://apply.example/Methods?tempJobid=1', kind: 'form', sketch: formSketch, image: '', reason: 'nothing filled', ...extra});

test('an application page: asked from the sketch alone, a click on a listed control is vetted; assist means the person clicks and is told which; Submit-like answers are not controls', async () => {
  const seen = [];
  const settings = {escalation: 'on', applicationNext: 'full'};
  const good = await escalate(storageOf(settings), askForm(), {client: fake({action: 'click', control: 'upload cv', why: 'reveals the file box', confidence: 0.9}, seen)});
  assert.deepEqual([good.action, good.control], ['click', 'Upload CV']);
  assert.ok(!JSON.stringify(seen[0]).includes('"type":"image"'), 'no picture in the cheap look');
  assert.match(JSON.stringify(seen[0]), /JOB APPLICATION/);
  const assist = await escalate(storageOf({escalation: 'on'}), askForm({url: 'https://apply.example/Other'}), {client: fake({action: 'click', control: 'Upload CV', why: 'x', confidence: 0.9})});
  assert.deepEqual([assist.action, assist.control, assist.why], ['ask_person', 'Upload CV', 'assist: the person clicks']);
  const made = await escalate(storageOf(settings), askForm({url: 'https://apply.example/Third'}), {client: fake({action: 'click', control: 'Submit application', why: 'x', confidence: 0.9})});
  assert.deepEqual([made.action, made.why], ['ask_person', 'the control is not on the page']);
  const typed = await escalate(storageOf(settings), askForm({url: 'https://apply.example/Fourth'}), {client: fake({action: 'fill', control: 'Copy and paste CV', why: 'x', confidence: 0.9})});
  assert.equal(typed.action, 'ask_person', 'an application page is never typed into by a closer look');
});

test('an application page: off stays off, and the picture goes only when the extension sends one', async () => {
  const seen = [];
  assert.equal((await escalate(storageOf({}), askForm(), {client: fake({}, seen)})).why, 'off');
  await escalate(storageOf({escalation: 'on', applicationNext: 'full'}), askForm({url: 'https://apply.example/Pic', image: Buffer.from('jpeg').toString('base64')}), {client: fake({action: 'wait', control: '', why: 'x', confidence: 1}, seen)});
  assert.ok(JSON.stringify(seen[0]).includes('"type":"image"'));
});

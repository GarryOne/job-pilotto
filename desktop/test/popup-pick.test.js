// Which button closes a popup (lib/popup-pick.js): Claude answers with one of the popup's own buttons or none, kept per popup; no AI, nothing pressed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pickDismiss} from '../lib/popup-pick.js';
import {pickPopup} from '../lib/server-pages.js';

const memory = () => { const files = {}; return {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}; };
const claude = (button, sent = []) => ({messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({button})}]}; }}});
const popup = {text: 'Bleiben Sie auf dem Laufenden mit unserem Newsletter!', buttons: ['Jetzt anmelden', 'Nein, danke']};

test('the closing button is picked from the popup\'s own, asked once, kept', async () => {
  const storage = memory(), sent = [];
  assert.deepEqual(await pickDismiss(storage, popup, {client: claude('Nein, danke', sent)}), {button: 'Nein, danke', how: 'ai'});
  assert.deepEqual(sent[0].output_config.format.schema.properties.button.enum, ['Jetzt anmelden', 'Nein, danke', '']);   // a fixed answer: one of them, or none
  assert.deepEqual(await pickDismiss(storage, popup, {client: claude('Jetzt anmelden', sent)}), {button: 'Nein, danke', how: 'kept'});
  assert.equal(sent.length, 1);
});

test('none: a button not on the popup, a popup that is the task, no AI', async () => {
  assert.equal((await pickDismiss(memory(), popup, {client: claude('Subscribe')})).button, '');
  assert.equal((await pickDismiss(memory(), popup, {client: claude('')})).button, '');
  assert.deepEqual(await pickDismiss(memory(), popup, {client: null}), {button: '', how: 'none'});
  assert.equal((await pickDismiss(memory(), {text: 'x', buttons: []}, {client: claude('x')})).button, '');
});

test('the extension\'s question reaches it', async () => {
  assert.deepEqual(await pickPopup(memory(), popup, {client: claude('Nein, danke')}), {ok: true, button: 'Nein, danke'});
});

// 10 Oct 2026 (spec step 5): a kept answer the page contradicts is dropped, so one bad pick cannot repeat on every visit.
test('the popup still there after its kept button: the answer is forgotten through the app, and asked again', async () => {
  const storage = memory(), sent = [];
  await pickDismiss(storage, popup, {client: claude('Jetzt anmelden', sent)});
  assert.deepEqual(await pickPopup(storage, {...popup, forget: true}, {client: null}), {ok: true, forgotten: true});
  assert.deepEqual(await pickDismiss(storage, popup, {client: claude('Nein, danke', sent)}), {button: 'Nein, danke', how: 'ai'});
  assert.equal(sent.length, 2);
});

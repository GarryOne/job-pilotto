// Which button closes a popup (lib/popup-pick.js): Claude answers with one of the popup's own buttons or none, kept per popup; no AI, nothing pressed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pickDismiss} from '../lib/popup-pick.js';
import {pickPopup} from '../lib/server-pages.js';

const memory = () => { const files = {}; return {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}; };
const claude = (button, sent = [], effect = 'closes_only') => ({messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({button, effect})}]}; }}});
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

// 11 Oct 2026 (Louis Vuitton jobs): a site's own "your fields may be replaced, continue?" after our upload: the closing button keeps the fill; the prompt says so.
test('a dialog that would replace what the applicant typed: the prompt tells to cancel, never continue', async () => {
  const sent = [], dialog = {text: 'Es posible que se sustituyan los campos que ya haya rellenado. ¿Está seguro de que desea continuar?', buttons: ['CONTINUAR', 'CANCELAR', 'X']};
  assert.equal((await pickDismiss(memory(), dialog, {client: claude('CANCELAR', sent)})).button, 'CANCELAR');
  assert.match(sent[0].system, /replace|overwrite/i);
  assert.match(sent[0].system, /cancel/i);
});

// The press floor (15 Oct 2026: "Decline" of a Data Privacy Consent Statement opened "Delete All Data"): a pick whose effect is not a plain close is never returned, never kept.
test('a pick that declines a consent, deletes or leaves is not pressed and not kept', async () => {
  for (const effect of ['declines_consent', 'deletes_or_leaves', 'other']) {
    const storage = memory();
    const statement = {text: 'Data Privacy Consent Statement', buttons: ['Accept', 'Decline', 'Print']};
    assert.deepEqual(await pickDismiss(storage, statement, {client: claude('Decline', [], effect)}), {button: '', how: 'ai'}, effect);
    assert.equal(storage.readText('popup-picks.json')?.includes('Decline') ?? false, false, `${effect} kept`);
  }
});

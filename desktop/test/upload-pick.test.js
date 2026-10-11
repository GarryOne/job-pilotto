// Which upload slot takes the CV as a document (lib/upload-pick.js): Claude answers with one of the slots' own titles or none, kept per set of titles; no AI, none.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pickUpload} from '../lib/upload-pick.js';
import {pickUploadSlot} from '../lib/server-pages.js';

const memory = () => { const files = {}; return {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}; };
const claude = (title, sent = []) => ({messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({title})}]}; }}});
const titles = ['Importar datos desde mi CV', 'Currículo *'];   // Louis Vuitton jobs, 11 Oct 2026

test('the document slot is picked from the slots\' own titles, asked once, kept', async () => {
  const storage = memory(), sent = [];
  assert.deepEqual(await pickUpload(storage, {titles}, {client: claude('Currículo *', sent)}), {title: 'Currículo *', how: 'ai'});
  assert.deepEqual(sent[0].output_config.format.schema.properties.title.enum, [...titles, '']);   // a fixed answer: one of them, or none
  assert.match(sent[0].system, /fill|read|import/i);   // the prompt names the feature that reads the CV to fill the form
  assert.deepEqual(await pickUpload(storage, {titles}, {client: claude('Importar datos desde mi CV', sent)}), {title: 'Currículo *', how: 'kept'});
  assert.equal(sent.length, 1);
});

test('none: a title not among them, none fits, no AI, fewer than two slots', async () => {
  assert.equal((await pickUpload(memory(), {titles}, {client: claude('Resume')})).title, '');
  assert.equal((await pickUpload(memory(), {titles}, {client: claude('')})).title, '');
  assert.deepEqual(await pickUpload(memory(), {titles}, {client: null}), {title: '', how: 'none'});
  assert.deepEqual(await pickUpload(memory(), {titles: ['CV']}, {client: claude('CV')}), {title: '', how: 'none'});
});

test('the extension\'s question reaches it', async () => {
  assert.deepEqual(await pickUploadSlot(memory(), {titles}, {client: claude('Currículo *')}), {ok: true, title: 'Currículo *'});
});

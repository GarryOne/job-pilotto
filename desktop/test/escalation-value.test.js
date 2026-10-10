// A closer look's "fill" gets its value from the person's own contact details, in the app, and only the extension receives it (lib/server-pages.js decideEscalation):
// never the model, never the log. A detail that is not saved becomes "ask the person".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {decideEscalation} from '../lib/server-pages.js';

const sketch = {url: 'https://karriere.example/career', title: 'Konto', headings: [], controls: [{type: 'text', label: 'E-Mail', required: true, state: 'empty', at: '50,30'}], buttons: ['Weiter'], texts: [], frames: []};
const storage = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-escv-')); return {settings: () => ({accountAutomation: 'full'}), path: name => path.join(dir, name)}; };
const body = () => ({url: 'https://karriere.example/career', kind: 'account', sketch, image: Buffer.from('jpeg').toString('base64'), reason: 'test'});
const model = (seen = []) => ({messages: {create: async request => { seen.push(JSON.stringify(request)); return {content: [{type: 'text', text: JSON.stringify({action: 'fill', control: 'E-Mail', detail: 'email', option: '', why: 'the email box is empty', confidence: 0.9})}], stop_reason: 'end_turn'}; }}});

test('the value for a fill comes from the saved contact details and is never in what the model was sent', async () => {
  const seen = [];
  const answer = await decideEscalation(storage(), body(), {client: model(seen), contact: async () => ({email: 'ada@example.test', first_name: 'Ada'})});
  assert.deepEqual([answer.action, answer.control, answer.detail, answer.value], ['fill', 'E-Mail', 'email', 'ada@example.test']);
  assert.ok(!seen.join('').includes('ada@example.test'));
});

test('a detail that is not saved in Your details is asked of the person, not invented', async () => {
  const answer = await decideEscalation(storage(), body(), {client: model(), contact: async () => ({first_name: 'Ada'})});
  assert.deepEqual([answer.action, answer.value], ['ask_person', undefined]);
  assert.equal((await decideEscalation(storage(), body(), {client: model(), contact: async () => { throw new Error('Notion is not connected'); }})).action, 'ask_person');
});

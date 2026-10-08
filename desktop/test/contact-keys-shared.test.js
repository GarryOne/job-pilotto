// Label meanings are learned once and shared (owner, 8 Oct 2026: "reuse learning from one installation to another ... while avoiding
// wasting AI money"): this Mac's cache, then the shared pack, then Claude; Claude's answers go back as proposals (wording + field only),
// and the extension fills by the shared meanings plus this Mac's own.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {keysFor} from '../lib/contact-keys.js';
import {forExtension} from '../lib/aliases.js';

const memory = (files = {}) => ({files, readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }, settings: () => ({telemetry: false})});
const claude = (items, sent) => ({messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({items})}]}; }}});

test('a wording another install taught needs no Claude call; a new one is asked once and proposed back, without any value', async () => {
  const storage = memory(), sent = [], proposed = [];
  const aliases = [{key: 'postal_code', phrase: "numéro postal d'acheminement"}];
  const keys = await keysFor(storage, ['Numéro postal d\'acheminement *', 'Rue et numéro'], {client: claude([{label: 'rue et numéro', key: 'street'}], sent),
    aliases, propose: items => proposed.push(...items)});
  assert.deepEqual(keys, {'Numéro postal d\'acheminement *': 'postal_code', 'Rue et numéro': 'street'});
  assert.deepEqual(JSON.parse(sent[0].messages[0].content), ['rue et numéro']);       // only the wording nobody knew
  assert.deepEqual(proposed, [{key: 'street', phrase: 'rue et numéro'}]);              // wording + field name: nothing of yours
});

test('the extension fills by the shared meanings and this Mac\'s own answers (shared first, no duplicates)', async () => {
  const storage = memory({'contact-label-keys.json': JSON.stringify({'rue et numéro': 'street', 'localité': 'location', 'indicatif de pays': ''}),
    'aliases-cache.json': JSON.stringify({at: Date.now(), aliases: [{key: 'location', phrase: 'localité'}]})});
  storage.settings = () => ({});
  const list = await forExtension(storage, {fetcher: async () => { throw new Error('offline'); }});
  assert.deepEqual(list.map(item => `${item.key}:${item.phrase}`).sort(), ['location:localité', 'street:rue et numéro']);
});

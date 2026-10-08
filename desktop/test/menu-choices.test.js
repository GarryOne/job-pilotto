// A menu's answer in another wording, remembered per site, field and answer (owner, 8 Oct 2026: "why does it first try +41?").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {choicesFor, rememberChoice} from '../lib/menu-choices.js';

const memory = () => { const files = {}; return {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}; };
const coop = 'https://career2.successfactors.eu/careers?company=Coop';

test('remembered per site, field and answer; a no-op is not kept; a newer choice replaces the older', () => {
  const storage = memory();
  assert.ok(rememberChoice(storage, {url: coop, label: 'Indicatif de pays', value: '+41', choice: 'Suisse'}));
  assert.ok(!rememberChoice(storage, {url: coop, label: 'Formule', value: 'Monsieur', choice: 'monsieur'}));   // the same wording: nothing to learn
  assert.deepEqual(choicesFor(storage, coop).map(c => c.choice), ['Suisse']);
  assert.deepEqual(choicesFor(storage, 'https://jobs.lever.co/x'), []);                                     // another site: nothing
  rememberChoice(storage, {url: coop, label: 'Indicatif de pays ', value: '+41', choice: 'Switzerland'});
  assert.deepEqual(choicesFor(storage, coop).map(c => c.choice), ['Switzerland']);
});

test('the re-arm remembers the choice Claude found, for the next fill on that site', async () => {
  const {menuRearm} = await import('../lib/menu-rearm.js');
  const storage = memory();
  const client = {messages: {create: async () => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({choice: 'Suisse'})}]})}};
  const listen = menuRearm({storage, client: () => client, queueFill: () => {}, later: () => {}});
  listen({id: 's1', tab: 1, url: coop, pending: ['Indicatif de pays'], proposals: [{label: 'Indicatif de pays', value: '+41', key: '', options: ['Suisse', 'France']}]});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(choicesFor(storage, coop).map(c => [c.label, c.value, c.choice]), [['Indicatif de pays', '+41', 'Suisse']]);
});

test('without a url, every remembered choice: the details are asked with the posting\'s address, the form may be elsewhere', () => {
  const storage = memory();
  rememberChoice(storage, {url: coop, label: 'Indicatif de pays', value: '+41', choice: 'Suisse'});
  assert.equal(choicesFor(storage, 'https://jobs.coop.ch/Coop/job/1').length, 0);
  assert.equal(choicesFor(storage).length, 1);
});

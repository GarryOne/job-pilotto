// A menu's row proposes one of the form's own choices, picked by meaning by Claude (owner, 8 Oct 2026: "Monsieur" was typed into a
// Madam/Sir menu; "use AI to decide, not brute force or hard-coded"). Only the exact same text is taken without asking.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pickOption} from '../lib/option-pick.js';
import {onChoices, pickProposal} from '../renderer/proposal-pick.js';

const memory = () => { const files = {}; return {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}; };
const claude = (choice, sent = []) => ({messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({choice})}]}; }}});

test('Claude picks the choice that means the same, from the form\'s choices only, once per answer and choices', async () => {
  const storage = memory(), sent = [], logged = [];
  const ask = {label: 'Opening formula', value: 'Monsieur', options: ['Madam', 'Sir']};
  assert.deepEqual(await pickOption(storage, ask, {client: claude('Sir', sent), log: (...line) => logged.push(line)}), {choice: 'Sir', how: 'ai'});
  assert.deepEqual(sent[0].output_config.format.schema.properties.choice.enum, ['Madam', 'Sir', '']);   // a fixed answer: a choice, or none
  assert.deepEqual(JSON.parse(sent[0].messages[0].content), {question: 'Opening formula', answer: 'Monsieur', choices: ['Madam', 'Sir']});
  assert.deepEqual(await pickOption(storage, {...ask, options: ['Sir', 'Madam']}, {client: claude('Madam', sent)}), {choice: 'Sir', how: 'kept'});
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(logged).includes('Monsieur'));             // the log: counts, never the answer
});

test('the same text needs no AI; a choice not on the form, or no AI, is none', async () => {
  const sent = [];
  assert.deepEqual(await pickOption(memory(), {value: 'sir', options: ['Madam', 'Sir']}, {client: claude('x', sent)}), {choice: 'Sir', how: 'same'});
  assert.equal(sent.length, 0);
  assert.deepEqual(await pickOption(memory(), {value: 'Monsieur', options: ['Madam', 'Sir']}, {client: claude('Mister')}), {choice: '', how: 'ai'});
  assert.deepEqual(await pickOption(memory(), {value: 'Monsieur', options: ['Madam', 'Sir']}, {client: null}), {choice: '', how: 'none'});
});

test('the row proposes the form\'s own choice: waiting while asked, the choice once known, "pick one" when none means the same', () => {
  const proposals = [{label: 'Opening formula', value: '', key: 'salutation', options: ['Madam', 'Sir']}];
  const proposal = pickProposal({proposals, label: 'Opening formula', contact: {salutation: 'Monsieur'}});
  assert.deepEqual(proposal.options, ['Madam', 'Sir']);
  assert.deepEqual([onChoices(proposal, undefined).value, onChoices(proposal, undefined).waiting], ['', true]);
  assert.equal(onChoices(proposal, 'Sir').value, 'Sir');
  assert.match(onChoices(proposal, '').from, /None of this form's choices means "Monsieur"/);
  assert.equal(onChoices({...proposal, value: 'sir'}, undefined).value, 'Sir');   // the same text: no question
});

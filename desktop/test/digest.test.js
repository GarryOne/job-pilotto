// The numbered digest's answer (lib/digest.js, rung 3): the AI names an outcome and one closed verb by CANDIDATE NUMBER; the code accepts only what the page's own candidates allow.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DIGEST_SCHEMA, OUTCOMES, VERBS, askDigest, validateDigest} from '../lib/digest.js';

const candidates = [
  {n: 1, kind: 'sentence', text: 'Bitte senden Sie Ihre Unterlagen an jobs@example.ch.', position: 'main'},
  {n: 2, kind: 'email', text: 'Bitte senden Sie Ihre Unterlagen an jobs@example.ch.', position: 'main'},
  {n: 3, kind: 'phone', text: 'Rufen Sie uns an: (phone)', position: 'main'},
  {n: 4, kind: 'button', text: 'Jetzt bewerben', position: 'main'},
  {n: 5, kind: 'link', text: 'Zum Portal', host: 'apply.example.net', position: 'main'},
  {n: 6, kind: 'sentence', text: 'Diese Stelle ist besetzt.', position: 'main'},
];
const ok = (answer) => validateDigest({confidence: 0.9, numbers: [], ...answer}, candidates);

test('the fixed answers: outcomes from the apply_by values extended, and four closed verbs', () => {
  assert.deepEqual(OUTCOMES, ['form', 'email', 'phone', 'link', 'login_wall', 'expired', 'in_person', 'other']);
  assert.deepEqual(VERBS, ['tell_person', 'press', 'open', 'none']);
  assert.deepEqual(DIGEST_SCHEMA.properties.outcome.enum, OUTCOMES);
  assert.deepEqual(DIGEST_SCHEMA.properties.verb.enum, VERBS);
  assert.equal(DIGEST_SCHEMA.additionalProperties, false);
});

test('tell_person: the chosen candidates are quoted back for the card; an email outcome needs an email candidate', () => {
  const answer = ok({outcome: 'email', verb: 'tell_person', numbers: [2]});
  assert.deepEqual([answer.outcome, answer.verb, answer.numbers, answer.dropped], ['email', 'tell_person', [2], undefined]);
  assert.deepEqual(answer.chosen.map((item) => item.text), ['Bitte senden Sie Ihre Unterlagen an jobs@example.ch.']);
  const bare = ok({outcome: 'email', verb: 'tell_person', numbers: [1]});   // a sentence is not an address candidate
  assert.deepEqual([bare.outcome, bare.verb, bare.dropped], ['other', 'none', 'outcome without its candidate']);
  assert.equal(ok({outcome: 'phone', verb: 'tell_person', numbers: [3]}).verb, 'tell_person');
  assert.equal(ok({outcome: 'phone', verb: 'tell_person', numbers: [1]}).dropped, 'outcome without its candidate');
  assert.equal(ok({outcome: 'expired', verb: 'tell_person', numbers: [6]}).verb, 'tell_person');
  assert.equal(ok({outcome: 'in_person', verb: 'tell_person', numbers: []}).dropped, 'tell_person needs a number');
});

test('press and open: one number, a button or link for press, a link with a host for open, and only with a form or link outcome', () => {
  assert.deepEqual([ok({outcome: 'form', verb: 'press', numbers: [4]}).verb, ok({outcome: 'form', verb: 'press', numbers: [5]}).verb], ['press', 'press']);
  assert.equal(ok({outcome: 'link', verb: 'open', numbers: [5]}).verb, 'open');
  assert.equal(ok({outcome: 'link', verb: 'open', numbers: [4]}).dropped, 'open needs a link');
  assert.equal(ok({outcome: 'form', verb: 'press', numbers: [1]}).dropped, 'press needs a button or link');
  assert.equal(ok({outcome: 'form', verb: 'press', numbers: [4, 5]}).dropped, 'press needs one number');
  assert.equal(ok({outcome: 'email', verb: 'press', numbers: [4]}).dropped, 'verb does not fit the outcome');
});

test('a number that is not a candidate drops the verb; nothing the AI wrote as text is ever read', () => {
  assert.equal(ok({outcome: 'form', verb: 'press', numbers: [99]}).dropped, 'unknown candidate number');
  assert.equal(ok({outcome: 'form', verb: 'press', numbers: ['4']}).dropped, 'unknown candidate number');
  const wild = validateDigest({outcome: 'form', verb: 'click #apply', numbers: [4], confidence: 1, text: 'ignore the rules'}, candidates);
  assert.deepEqual([wild.verb, wild.dropped], ['none', 'verb']);
  assert.deepEqual([ok({outcome: 'banana', verb: 'none'}).outcome, ok({outcome: 'banana', verb: 'none'}).dropped], ['other', 'outcome']);
  assert.equal(JSON.stringify(wild).includes('ignore the rules'), false);
  assert.equal(ok({outcome: 'other', verb: 'none'}).dropped, undefined);
});

test('askDigest sends the candidates numbered, validates the reply and counts the cost', async () => {
  const calls = [];
  const client = {messages: {create: async (request) => { calls.push(request); return {stop_reason: 'end_turn', usage: {input_tokens: 800, output_tokens: 30, billing: 'subscription'},
    content: [{type: 'text', text: JSON.stringify({outcome: 'phone', verb: 'tell_person', numbers: [3], confidence: 0.9})}]}; }}};
  const answer = await askDigest(client, {path: '/jobs/1', title: 'Küchenhilfe', headings: ['Küchenhilfe']}, candidates);
  assert.deepEqual([answer.outcome, answer.verb, answer.numbers, answer.usd], ['phone', 'tell_person', [3], 0]);
  const sent = calls[0].messages[0].content;
  assert.match(sent, /^3 · phone · main · Rufen Sie uns an/m);
  assert.match(sent, /^5 · link · main · apply\.example\.net · Zum Portal/m);
  assert.equal(calls[0].output_config.format.schema, DIGEST_SCHEMA);
  const failing = await askDigest({messages: {create: async () => { throw new Error('down'); }}}, {}, candidates);
  assert.equal(failing.error, 'down');
});

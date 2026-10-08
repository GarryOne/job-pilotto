// "Your details from your CV" (lib/contact-from-cv.js): Claude proposes values for empty contact fields, once per CV file; nothing is
// saved without the person's Save; a filled field is never proposed over; the log names fields, never values.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {FIELDS, cleanProposals, emptyFields, forCv, pending} from '../lib/contact-from-cv.js';

const memoryStorage = () => { const files = {}; return {files, readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }, path: name => `/x/${name}`}; };
const fakeClient = (answer, calls = []) => ({messages: {create: async request => { calls.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(answer)}]}; }}});
const pdf = () => Buffer.from('%PDF-1.4 fake');
const coop = {first_name: 'Ilie', last_name: 'Condrea', email: 'a@b.c'};

test('only empty, known fields are asked for and kept; one per field; salutation is always "check it"', () => {
  assert.ok(!emptyFields(coop).includes('first_name') && emptyFields(coop).includes('phone') && emptyFields(coop).includes('salutation'));
  assert.ok(!FIELDS.includes('full_name'));
  const wanted = ['phone', 'postal_code', 'salutation'];
  assert.deepEqual(cleanProposals([{field: 'phone', value: ' +41 79 000 00 00 ', sure: true}, {field: 'phone', value: 'other', sure: true},
    {field: 'first_name', value: 'X', sure: true}, {field: 'postal_code', value: '', sure: true}, {field: 'salutation', value: 'Monsieur', sure: true}], wanted),
  [{field: 'phone', value: '+41 79 000 00 00', sure: true}, {field: 'salutation', value: 'Monsieur', sure: false}]);
});

test('one Claude call per CV file: the CV goes as a PDF, the answer is kept, and a field filled since drops out', async () => {
  const storage = memoryStorage(), calls = [], logged = [];
  const client = fakeClient({proposals: [{field: 'postal_code', value: '1260', sure: true}, {field: 'location', value: 'Nyon', sure: true}]}, calls);
  const first = await forCv(storage, {contact: coop, client, cvHash: 'cv1', log: (...line) => logged.push(line), read: pdf});
  assert.deepEqual(first.proposals.map(item => item.field), ['postal_code', 'location']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[0].content[0].type, 'document');
  assert.ok(calls[0].max_tokens >= 8000);
  // The log: which fields, never a value.
  assert.match(logged[0][1], /2 of \d+ proposed/);
  assert.deepEqual(logged[0][2].proposed, ['postal_code', 'location']);
  assert.ok(!JSON.stringify(logged).includes('1260') && !JSON.stringify(logged).includes('Nyon'));
  // Opening Profile again: no new call; you typed the town meanwhile, so only the postal code is still proposed.
  const again = await forCv(storage, {contact: {...coop, location: 'Genève'}, client, cvHash: 'cv1', read: pdf});
  assert.equal(calls.length, 1);
  assert.deepEqual(again.proposals.map(item => item.field), ['postal_code']);
  // A new CV is read once more; "Fill from my CV" (again) reads the same CV anew.
  await forCv(storage, {contact: coop, client, cvHash: 'cv2', read: pdf});
  await forCv(storage, {contact: coop, client, cvHash: 'cv2', read: pdf, again: true});
  assert.equal(calls.length, 3);
});

test('a failure is kept for that CV (no paying again on every open) and said; no AI or no CV: nothing asked', async () => {
  const storage = memoryStorage(), logged = [];
  const broken = {messages: {create: async () => ({stop_reason: 'max_tokens', content: [{type: 'text', text: '{"propo'}]})}};
  const failed = await forCv(storage, {contact: coop, client: broken, cvHash: 'cv1', log: (...line) => logged.push(line), read: pdf});
  assert.deepEqual([failed.proposals, /cut short/.test(failed.error)], [[], true]);
  assert.match(logged[0][1], /failed/);
  assert.equal((await forCv(storage, {contact: coop, client: broken, cvHash: 'cv1', read: pdf})).fresh, false);
  assert.deepEqual((await forCv(memoryStorage(), {contact: coop, client: null, cvHash: 'cv1'})).error, 'no AI');
  assert.deepEqual((await forCv(memoryStorage(), {contact: coop, client: broken, cvHash: ''})).proposals, []);
  assert.deepEqual(pending({cv: 'old', proposals: [{field: 'phone', value: '1'}]}, 'new', coop), []);
});

test('the window shows proposals in the Your details boxes and Save is the only way they are kept', () => {
  const page = fs.readFileSync(new URL('../renderer/pages/contact-proposals.js', import.meta.url), 'utf8');
  const profile = fs.readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.ok(!/saveContact/.test(page), 'proposals never save by themselves');
  assert.match(profile, /loadProposals\(\);/);
  assert.match(html, /id="contact-from-cv"/);
  assert.match(html, /data-contact="salutation"/);
});

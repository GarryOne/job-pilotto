// What kind of page is this (lib/page-kind.js): the AI decides from a sketch in any language, among fixed kinds; kept per page shape.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {KINDS, ROLE, kindKey, pageBuild, pageKind, pageKindCache, pageShape, pageSketch} from '../lib/page-kind.js';

const fake = (answer, calls = []) => ({messages: {create: async request => { calls.push(request); return {stop_reason: 'end_turn', usage: {input_tokens: 600, output_tokens: 20},
  content: [{type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer)}]}; }}});
const coop = {url: 'https://career2.successfactors.eu/careers?company=Coop&token=secret', title: 'Postuler', headings: ['Êtes-vous déjà inscrit ?'],
  controls: [{type: 'file', label: 'CV et diplômes', required: true}, {type: 'email', label: 'E-mail', required: true}, {type: 'password', label: 'Choisissez un mot de passe', required: true}],
  buttons: ['Envoyer']};
const cacheIn = () => pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-')), 'page-kinds.json'));

test('each posting of a site is one shape; the query string never counts', () => {
  assert.equal(pageShape('https://live.solique.ch/manor/job/details/4080388/'), 'live.solique.ch/manor/job/details/*');
  assert.equal(pageShape('https://live.solique.ch/manor/job/details/4080999/?utm=x'), 'live.solique.ch/manor/job/details/*');
  assert.equal(pageShape('https://career2.successfactors.eu/careers?company=Coop'), 'career2.successfactors.eu/careers');
  assert.equal(pageShape('not a url'), '');
});

test('the AI sees a sketch in the page\'s own language, never typed values or the query string', async () => {
  const calls = [];
  const sketch = pageSketch({...coop, controls: [...coop.controls, {type: 'text', label: 'Prénom', value: 'Igor'}]});
  assert.equal(sketch.path, '/careers');
  assert.equal(JSON.stringify(sketch).includes('Igor'), false);
  await pageKind(fake({kind: 'account-form', confidence: 0.9}, calls), coop, cacheIn());
  const sent = calls[0].messages[0].content;
  assert.match(sent, /file · CV et diplômes · required/);
  assert.equal(sent.includes('secret'), false);
});

test('an answer is kept per shape: asked once, remembered after; its role is what the flows go by', async () => {
  const calls = [], cache = cacheIn();
  const first = await pageKind(fake({kind: 'account-form', confidence: 0.92}, calls), coop, cache);
  assert.deepEqual([first.kind, first.role, first.by], ['account-form', 'form', 'ai']);
  assert.ok(first.usd >= 0);
  const again = await pageKind(fake({kind: 'account', confidence: 1}, calls), {...coop, url: 'https://career2.successfactors.eu/careers?company=Migros'}, cache);
  assert.deepEqual([again.kind, again.by, calls.length], ['account-form', 'remembered', 1]);
});

test('no AI, an unknown word, a low confidence or a failure: no kind, the structure rule decides, nothing kept', async () => {
  const cache = cacheIn();
  assert.equal((await pageKind(null, coop, cache)).error, 'no AI');
  assert.equal((await pageKind(fake({kind: 'login', confidence: 1}), coop, cache)).error, 'not a kind');
  assert.match((await pageKind(fake({kind: 'form', confidence: 0.3}), coop, cache)).error, /unsure/);
  assert.equal((await pageKind(fake('not json'), coop, cache)).error, 'not JSON');
  assert.equal((await pageKind({messages: {create: async () => { throw new Error('overloaded'); }}}, coop, cache)).error, 'overloaded');
  assert.equal(cache.get(kindKey(coop)), null);
});

test('every kind maps to a role the flows know', () => {
  for (const kind of KINDS) assert.ok(['form', 'account', 'no-form'].includes(ROLE[kind]), kind);
});

test('the same address shape built differently is asked again: a job page with the form, another with only an Apply link', async () => {
  const calls = [], cache = cacheIn();
  const form = {url: 'https://boards.greenhouse.io/acme/jobs/1', title: 'Engineer', controls: [{type: 'text', label: 'First'}, {type: 'text', label: 'Last'}, {type: 'email', label: 'Email'}, {type: 'file', label: 'Resume'}], buttons: ['Submit']};
  const posting = {url: 'https://boards.greenhouse.io/other/jobs/2', title: 'Engineer', headings: ['About the role'], controls: [], buttons: ['Apply']};
  assert.notEqual(pageBuild(form.controls), pageBuild(posting.controls));
  await pageKind(fake({kind: 'form', confidence: 0.9}, calls), form, cache);
  const second = await pageKind(fake({kind: 'posting', confidence: 0.9}, calls), posting, cache);
  assert.deepEqual([second.kind, second.by, calls.length], ['posting', 'ai', 2]);
  // A second job page built like the first: remembered.
  const third = await pageKind(fake({kind: 'posting', confidence: 0.9}, calls), {...form, url: 'https://boards.greenhouse.io/acme/jobs/3'}, cache);
  assert.deepEqual([third.kind, third.by, calls.length], ['form', 'remembered', 2]);
});

test('self-correction: a kept kind the page contradicted is dropped, and the next visit asks again', async () => {
  const {forgetPageKind} = await import('../lib/page-kind.js');
  const calls = [], cache = cacheIn();
  const form = {url: 'https://jobs.example.org/apply/7', controls: [{type: 'text', label: 'Nom'}, {type: 'email', label: 'Courriel'}, {type: 'file', label: 'CV'}], buttons: ['Envoyer']};
  await pageKind(fake({kind: 'posting', confidence: 0.8}, calls), form, cache);           // wrong, and kept
  assert.equal((await pageKind(fake({kind: 'form', confidence: 0.9}, calls), form, cache)).by, 'remembered');
  assert.ok(forgetPageKind(cache, form));
  const again = await pageKind(fake({kind: 'form', confidence: 0.9}, calls), form, cache);
  assert.deepEqual([again.kind, again.by, calls.length], ['form', 'ai', 2]);
  assert.equal(forgetPageKind(cache, {url: 'https://nothing.example/x'}), '');               // nothing kept: nothing dropped
});

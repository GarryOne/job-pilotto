// The AI's readiness judgment on an application form (lib/form-judge.js): fixed answers, a control only if the page lists it, no AI means no answer, no typed value is sent.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {judgeForm} from '../lib/form-judge.js';
import {decideAccountJudge} from '../lib/server-pages.js';

const page = {url: 'https://jobs.example.ch/apply/1?token=SECRET', title: 'Postuler', headings: ['Postuler'],
  controls: [{type: 'text', label: 'Prénom', required: true, state: 'filled', value: 'Ada'}, {type: 'select', label: 'Formule d\'appel', required: true, state: 'filled'}],
  buttons: ['Lire et accepter la déclaration de confidentialité', 'Envoyer'], texts: ['La déclaration est obligatoire'], frames: []};
const fake = (answer, seen = []) => ({messages: {create: async body => { seen.push(body); return {content: [{type: 'text', text: JSON.stringify(answer)}], stop_reason: 'end_turn'}; }}});

test('a consent that is a LINK is what the panel\'s count cannot see: the AI says needs_person and names it, from what the page lists', async () => {
  const seen = [];
  const got = await judgeForm(fake({answer: 'needs_person', needs: 'lire et accepter la déclaration de confidentialité', needs_kind: 'consent', confidence: 0.9}, seen), page);
  assert.deepEqual([got.answer, got.needs, got.needsKind], ['needs_person', 'Lire et accepter la déclaration de confidentialité', 'consent']);
  const sent = JSON.stringify(seen[0]);
  assert.ok(!sent.includes('Ada') && !sent.includes('SECRET'), 'no typed value and no query string reach the model');
  assert.ok(sent.includes('La déclaration est obligatoire'));
});

test('ready is ready; a control the page does not list is dropped; an answer outside the fixed ones, or no AI, is an error', async () => {
  assert.equal((await judgeForm(fake({answer: 'ready', needs: '', needs_kind: '', confidence: 0.9}), page)).answer, 'ready');
  assert.equal((await judgeForm(fake({answer: 'needs_person', needs: 'Made-up control', needs_kind: 'field', confidence: 0.9}), page)).needs, '');
  assert.equal((await judgeForm(fake({answer: 'created', needs: '', needs_kind: '', confidence: 0.9}), page)).error, 'not an answer');
  assert.equal((await judgeForm(null, page)).error, 'no AI');
});

test('the route answers phase "form" with the form judge, never the account one', async () => {
  const calls = [];
  const answer = await decideAccountJudge({}, {phase: 'form', sketch: page}, {client: fake({answer: 'needs_person', needs: 'Envoyer', needs_kind: 'other', confidence: 0.8}, calls)});
  assert.deepEqual([answer.ok, answer.answer, answer.needs], [true, 'needs_person', 'Envoyer']);
  assert.ok(JSON.stringify(calls[0]).includes('JOB APPLICATION form'));
});

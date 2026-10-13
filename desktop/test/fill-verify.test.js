// The fill ladder's fill_verify question (lib/ladder/fill-verify.js) and its shadow route (lib/server-pages.js phase "fill"): numbered controls with a local match, never a value;
// only numbers the sketch has and fixed verdicts are kept; the route logs and returns, nothing acts.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {countsOf, INSTRUCTIONS, judgeFill, validVerdicts} from '../lib/ladder/fill-verify.js';
import {accountSketch} from '../lib/account-judge.js';

const raw = {url: 'https://jobs.example.com/apply/1', title: 'Apply', controls: [
  {type: 'text', label: 'First name', required: true, state: 'filled', match: 'yes'},
  {type: 'text', label: 'Current city', required: true, state: 'empty', match: 'no'},
  {type: 'select-one', label: 'Country', required: false, state: 'empty', options: ['Choose', 'Switzerland']},
  {type: 'text', label: 'Middle name', required: false, state: 'empty', match: 'maybe'}], buttons: ['Submit'], texts: [], frames: []};
const client = answer => {
  const sent = [];
  return {sent, messages: {create: async body => { sent.push(body); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(answer)}]}; }}};
};

test('the sketch keeps a match of yes or no only, never a value', () => {
  const sketch = accountSketch({...raw, controls: [...raw.controls, {type: 'text', label: 'x', state: 'filled', match: 'no', value: 'secret'}]});
  assert.deepEqual(sketch.controls.map(item => item.match), ['yes', 'no', '', '', 'no']);
  assert.ok(!JSON.stringify(sketch).includes('secret'));
});

test('the model sees numbered controls with their match and never a value', async () => {
  const fake = client({controls: [{n: 1, verdict: 'ok', reason: ''}, {n: 2, verdict: 'wrong', reason: 'not_kept'}]});
  const found = await judgeFill(fake, raw);
  const text = fake.sent[0].messages[0].content;
  assert.match(text, /\[1\] text · First name · required · filled · match yes/);
  assert.match(text, /\[2\] text · Current city · required · empty · match no/);
  assert.match(text, /\[4\] text · Middle name · empty · match -/);
  assert.equal(fake.sent[0].system, INSTRUCTIONS);
  assert.deepEqual(found.verdicts, [{n: 1, label: 'First name', verdict: 'ok', reason: ''}, {n: 2, label: 'Current city', verdict: 'wrong', reason: 'not_kept'}]);
  assert.deepEqual(found.counts, {ok: 1, empty: 0, wrong: 1, unreachable: 0, unsure: 0});
});

test('a number the sketch does not have, a repeated number or an unknown verdict is dropped; a miss without a known reason is "other"', () => {
  const sketch = accountSketch(raw);
  const rows = validVerdicts({controls: [{n: 0, verdict: 'ok'}, {n: 9, verdict: 'ok'}, {n: 2, verdict: 'empty', reason: 'because'}, {n: 2, verdict: 'ok'}, {n: 3, verdict: 'fine'}, {n: '1', verdict: 'ok', reason: 'covered'}]}, sketch);
  assert.deepEqual(rows, [{n: 1, label: 'First name', verdict: 'ok', reason: ''}, {n: 2, label: 'Current city', verdict: 'empty', reason: 'other'}]);
  assert.deepEqual(countsOf([]), {ok: 0, empty: 0, wrong: 0, unreachable: 0, unsure: 0});
});

test('nothing the fill touched, no AI or a broken answer: no verdicts, an error', async () => {
  assert.deepEqual(await judgeFill(null, raw), {error: 'no AI'});
  assert.deepEqual(await judgeFill(client({controls: []}), {...raw, controls: raw.controls.map(({match, ...item}) => item)}), {error: 'nothing the fill touched'});
  const broken = {messages: {create: async () => ({stop_reason: 'end_turn', content: [{type: 'text', text: 'not json'}]})}};
  assert.ok((await judgeFill(broken, raw)).error);
});

test('the shadow route logs and returns the verdicts; it never asks for an action', async () => {
  const {decideAccountJudge} = await import('../lib/server-pages.js');
  const answer = await decideAccountJudge({settings: () => ({})}, {phase: 'fill', sketch: raw}, {client: client({controls: [{n: 2, verdict: 'empty', reason: 'not_kept'}]})});
  assert.equal(answer.answer, 'shadow');
  assert.deepEqual(answer.counts, {ok: 0, empty: 1, wrong: 0, unreachable: 0, unsure: 0});
  assert.ok(!('action' in answer) && !('needs' in answer));
});

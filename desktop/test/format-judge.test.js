// The AI's pick of another writing for a value a site refused (lib/format-judge.js): a fixed list, never one already tried, never the value sent, and the route answers phase "format".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FORMATS, judgeFormat} from '../lib/format-judge.js';
import {decideAccountJudge} from '../lib/server-pages.js';

const fake = (answer, seen = []) => ({messages: {create: async body => { seen.push(body); return {content: [{type: 'text', text: JSON.stringify(answer)}], stop_reason: 'end_turn'}; }}});
const ask = {label: 'Phone', message: 'This Phone Number Format is not Allowed.', tried: []};

test('the site\'s message and the label go to the AI, never a number; the answer is one of the fixed writings', async () => {
  const seen = [];
  const got = await judgeFormat(fake({format: 'national_plain', confidence: 0.8}, seen), {...ask, value: '+41 79 555 01 23'});
  assert.deepEqual([got.answer, got.format], ['national_plain', 'national_plain']);
  const sent = JSON.stringify(seen[0].messages);
  assert.ok(sent.includes('Phone Number Format is not Allowed') && !sent.includes('555'), 'the message, not the number');
});

test('a writing already tried, one outside the list, an empty message and no AI never give a writing', async () => {
  assert.equal((await judgeFormat(fake({format: 'e164', confidence: 0.9}), {...ask, tried: ['e164']})).format, 'none');
  assert.equal((await judgeFormat(fake({format: 'dashes', confidence: 0.9}), ask)).format, 'none');
  assert.equal((await judgeFormat(fake({format: 'e164', confidence: 0.9}), {...ask, message: ''})).error, 'no message');
  assert.equal((await judgeFormat(null, ask)).error, 'no AI');
  assert.deepEqual(FORMATS, ['e164', 'e164_digits', 'international_00', 'national', 'national_plain']);
});

test('the route answers phase "format" with the format judge', async () => {
  const answer = await decideAccountJudge({}, {phase: 'format', ...ask}, {client: fake({format: 'national', confidence: 0.7})});
  assert.deepEqual([answer.ok, answer.answer, answer.format], [true, 'national', 'national']);
});

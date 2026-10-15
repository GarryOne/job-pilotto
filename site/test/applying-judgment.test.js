// Guards src/applying-judgment.js (owner, 15 Oct 2026): Needs a fix and Resolution read the same, newest judgment of each pool row.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ENDING_STATE, oneJudgment} from '../src/applying-judgment.js';
import {needsFixOrder} from '../src/applying-order.js';

const row = (name, state, day, rule = '') => ({name, shape: name, platform: 'Custom', day, reached: 'form', status: {state, rule, step: 'form'}});
const ending = (name, word, day) => ({row: name, ending: word, day, step: 'form'});

test('a newer or same-day ending decides the status; an older one never does; a named hold stays a hold', () => {
  const pool = [row('missed field', 'works', '2026-10-15'), row('told', 'fix', '2026-10-15'), row('old ending', 'works', '2026-10-15'), row('a hold', 'held', '2026-10-15', 'login wall'),
    row('never smoke-run', 'works', null), row('site gone', 'fix', '2026-10-14')];
  oneJudgment(pool, {rows: [ending('missed field', 'unresolved', '2026-10-15'), ending('told', 'told', '2026-10-15'), ending('old ending', 'unresolved', '2026-10-13'),
    ending('a hold', 'unresolved', '2026-10-15'), ending('never smoke-run', 'unresolved', '2026-10-13'), ending('site gone', 'site_broken', '2026-10-15')]});
  const state = Object.fromEntries(pool.map(item => [item.name, item.status.state]));
  assert.deepEqual(state, {'missed field': 'fix', told: 'held', 'old ending': 'works', 'a hold': 'held', 'never smoke-run': 'fix', 'site gone': 'site'});
  assert.equal(pool[0].status.rule, 'ending: unresolved');
});

test('Needs a fix holds every row whose deciding ending is unresolved, and none it calls resolved', () => {
  const words = Object.keys(ENDING_STATE);
  const pool = words.map(word => row(word, word === 'unresolved' ? 'works' : 'fix', '2026-10-15'));
  oneJudgment(pool, {rows: words.map(word => ending(word, word, '2026-10-15'))});
  const listed = needsFixOrder(pool, [], ['none', 'posting', 'account', 'code/bot', 'form', 'ready']).rows.map(item => item.name).sort();
  assert.deepEqual(listed, words.filter(word => ENDING_STATE[word] === 'fix').sort());
});

// The ladder chart's split of each rung's sites by outcome (fine / held / failed): one fixture with every kind on every rung, the empty state, and the card wiring.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ladderSplit, SPLIT_KINDS} from '../src/applying-ladder-split.js';
import {PAGE} from '../src/applying.js';

const row = (rung, state) => ({rung, status: {state}});
const POOL = [0, 1, 2].flatMap(rung => [row(rung, 'works'), row(rung, 'held'), row(rung, 'held'), row(rung, 'fix'), row(rung, 'site'), row(rung, 'unrun')]).concat([row(2, 'works'), row(null, 'works')]);

test('each rung splits into fine / held / failed; a stop with no hold and not working (fix, posting gone, not run) is failed', () => {
  const split = ladderSplit(POOL);
  assert.equal(split.total, 19);
  assert.deepEqual(split.byRung[0], {fine: 1, held: 2, failed: 3, count: 6});
  assert.deepEqual(split.byRung[1], {fine: 1, held: 2, failed: 3, count: 6});
  assert.deepEqual(split.byRung[2], {fine: 2, held: 2, failed: 3, count: 7});
  for (const rung of Object.values(split.byRung)) assert.equal(rung.fine + rung.held + rung.failed, rung.count);
  assert.deepEqual(SPLIT_KINDS.map(kind => kind.key), ['fine', 'held', 'failed']);
});

test('a row without a rung is not counted; an empty pool has no split', () => {
  assert.equal(ladderSplit([row(null, 'works')]).total, 0);
  assert.deepEqual(ladderSplit([]), {total: 0, byRung: {}});
  assert.deepEqual(ladderSplit(undefined), {total: 0, byRung: {}});
});

test('the card draws the three parts with the tile colours, the counts in the line and the tooltip', () => {
  const css = PAGE.slice(PAGE.indexOf('.ladder'));
  for (const [cls, token] of [['fine', 'green'], ['held', 'violet'], ['failed', 'red']]) assert.match(css, new RegExp('\\.ladder \\.share \\.bar i\\.' + cls + '\\{[^}]*var\\(--' + token + '\\)'));
  assert.match(PAGE, /ladderSplit/);
  assert.ok(PAGE.includes("SPLIT_KINDS.map(kind => rungParts(n)[kind.key] + ' ' + kind.word).join(', ')"), 'the line lists each count');
});

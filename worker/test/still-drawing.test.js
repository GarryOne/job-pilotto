// A page the AI calls "still being drawn" is read again once it is still; capped, with the cause logged (extension/ladder/still-drawing.js, desktop/lib/ladder/rung2-sketch.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MAX_LOOKS, readWhileDrawing} from '../../extension/ladder/still-drawing.js';

const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
const rig = answers => { const logs = [], state = {waits: 0, asks: 0}; return {logs, state, deps: {again: async () => answers[state.asks++], still: async () => { state.waits++; }, log: (...row) => logs.push(row), host: 'h'}}; };

test('a placeholder page is read again after it is still, until the AI calls it drawn', async () => {
  const {deps, state, logs} = rig([{role: 'form', stillDrawing: false}]);
  const got = await readWhileDrawing({role: 'no-form', stillDrawing: true}, deps);
  assert.equal(got.role, 'form');
  assert.deepEqual([state.waits, state.asks], [1, 1]);
  assert.equal(logs[0][2].cause, 'settled');
});

test('a page that never settles is read as it stands after the cap, with the cause logged', async () => {
  const {deps, state, logs} = rig(Array.from({length: 9}, () => ({role: 'no-form', stillDrawing: true})));
  const got = await readWhileDrawing({role: 'no-form', stillDrawing: true}, deps);
  assert.equal(state.asks, MAX_LOOKS);
  assert.equal(got.role, 'no-form');
  assert.equal(logs[0][2].cause, 'cap');
});

test('a drawn page, or no answer, costs no wait', async () => {
  const {deps, state} = rig([]);
  assert.deepEqual(await readWhileDrawing({role: 'form'}, deps), {role: 'form'});
  assert.equal(await readWhileDrawing(null, deps), null);
  assert.equal(state.waits, 0);
});

test('the fill reads the page-kind answer through it', () => {
  assert.match(flow, /readWhileDrawing\(/);
});

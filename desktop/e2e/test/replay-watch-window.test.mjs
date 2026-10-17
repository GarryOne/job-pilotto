// The watch window of a case with only "must not happen" checks ends on the real signal (the fill is over and the page went quiet), never later than its deadline, and never early while the fill runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {watchWindow} from '../lib/page-replay.mjs';

const pageWith = states => { let index = 0; return {evaluate: async () => (states[Math.min(index++, states.length - 1)])}; };
const pageOf = states => { const page = pageWith(states); return () => page; };
const took = async run => { const began = Date.now(); await run(); return Date.now() - began; };

test('a finished fill and a quiet page end the window early', async () => {
  const ms = await took(() => watchWindow(pageOf([{state: 'running'}, {state: 'done'}]), () => [], Date.now() + 10000, {quietMs: 600, minMs: 600}));
  assert.ok(ms < 4000, `took ${ms} ms`);
});

test('a fill still running keeps the whole window', async () => {
  const ms = await took(() => watchWindow(pageOf([{state: 'running'}]), () => [], Date.now() + 2000, {quietMs: 300, minMs: 300}));
  assert.ok(ms >= 1900, `ended after ${ms} ms while the fill ran`);
});

test('a page with no fill state keeps the whole window', async () => {
  const ms = await took(() => watchWindow(pageOf([null]), () => [], Date.now() + 2000, {quietMs: 300, minMs: 300}));
  assert.ok(ms >= 1900, `ended after ${ms} ms with no fill state`);
});

test('a request that keeps coming keeps the window open', async () => {
  const requests = [], timer = setInterval(() => requests.push({route: '/extension/log'}), 200);
  const ms = await took(() => watchWindow(pageOf([{state: 'done'}]), () => requests, Date.now() + 2000, {quietMs: 800, minMs: 300}));
  clearInterval(timer);
  assert.ok(ms >= 1900, `ended after ${ms} ms while requests kept coming`);
});

test('the panel\'s repeated report is not an act: it does not keep the window open', async () => {
  const requests = [], timer = setInterval(() => requests.push({route: '/extension/review'}), 200);
  const ms = await took(() => watchWindow(pageOf([{state: 'done'}]), () => requests, Date.now() + 10000, {quietMs: 600, minMs: 600}));
  clearInterval(timer);
  assert.ok(ms < 4000, `took ${ms} ms`);
});

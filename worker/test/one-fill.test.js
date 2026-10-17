// A tab is never filled twice on the SAME page at once (a second ask joins), but a new document in the tab gets its own fill, and a fill's card id never lands on a page it did not fill (run 39060910058, Windows).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {oneFillPerTab, stillOnPage} from '../../extension/one-fill.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a second ask for the same page 0.2 s after the first joins it: one fill, one result', async () => {
  let starts = 0, joins = 0;
  const slow = () => new Promise(resolve => { starts++; setTimeout(() => resolve({filled: 4}), 60); });
  const first = oneFillPerTab(7, 'https://x.test/a#jobpilotto-fill', slow, {onJoin: () => joins++});
  await wait(20);
  const second = oneFillPerTab(7, 'https://x.test/a', slow, {onJoin: () => joins++});
  assert.deepEqual(await Promise.all([first, second]), [{filled: 4}, {filled: 4}]);
  assert.equal(starts, 1); assert.equal(joins, 1);
  await oneFillPerTab(7, 'https://x.test/a', slow); assert.equal(starts, 2, 'after it ended, the next ask fills again');
});

test('a new document in the same tab gets its own fill while the old page still fills', async () => {
  const ran = [];
  const fill = name => () => new Promise(resolve => { ran.push(name); setTimeout(() => resolve(name), name === 'signup' ? 80 : 20); });
  const signup = oneFillPerTab(9, 'https://x.test/signup', fill('signup'));
  await wait(10);
  const form = oneFillPerTab(9, 'https://x.test/signup-application', fill('form'));
  assert.deepEqual(await Promise.all([signup, form]), ['signup', 'form']);
  assert.deepEqual(ran, ['signup', 'form'], 'both fills ran; the form was not handed to the sign-up fill');
});

test('another tab and a failed fill do not block', async () => {
  await assert.rejects(oneFillPerTab(1, 'https://x.test/a', async () => { throw new Error('x'); }));
  assert.equal(await oneFillPerTab(1, 'https://x.test/a', async () => 'again'), 'again');
  const [a, b] = await Promise.all([oneFillPerTab(2, 'https://x.test/a', async () => 'a'), oneFillPerTab(3, 'https://x.test/a', async () => 'b')]);
  assert.deepEqual([a, b], ['a', 'b']);
});

test('a fill writes its card id only while the tab is on its page', () => {
  assert.equal(stillOnPage('https://x.test/signup#jobpilotto-fill', 'https://x.test/signup'), true);
  assert.equal(stillOnPage('https://x.test/signup', 'https://x.test/signup-application#job'), false);
  assert.equal(stillOnPage('https://x.test/signup', undefined), true, 'tab gone: nothing to protect');
});

test('the class: every fill starts through oneFillPerTab, and flow.js writes the card id through stillOnPage', () => {
  const bg = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  assert.equal([...bg.matchAll(/fillOpenedTabNow\(/g)].length, 2, 'defined once, called once (inside oneFillPerTab)');
  assert.match(bg, /oneFillPerTab\(tab\.id, tab\.url, async \(\) => \{\s*fillsNow\.add\(tab\.id\);\s*try \{ return await fillOpenedTabNow/);
  const flow = fs.readFileSync(new URL('../../extension/flow.js', import.meta.url), 'utf8');
  const writers = [...flow.matchAll(/dataset\.jobpilottoFill = id/g)].length;
  assert.equal(writers, 1); assert.match(flow, /if \(stillOnPage\(tab\.url, [^\n]*dataset\.jobpilottoFill = id/);
});

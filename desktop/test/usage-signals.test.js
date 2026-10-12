// Usage signals (renderer/usage-signals.js + lib/analytics.js usageEvent): active vs idle seconds per screen, clicks as a control's own name and place, nothing else.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {usageEvent, EVENTS} from '../lib/analytics.js';
import {controlName, createUsage} from '../renderer/usage-signals.js';

const clock = () => { const c = {t: 0, now: () => c.t, advance: ms => { c.t += ms; }}; return c; };

test('seconds on a screen split into active (input in the last 60 s) and idle, sent when the screen changes', () => {
  const c = clock(), sent = [], u = createUsage({send: p => sent.push(p), now: c.now});
  u.viewChanged('jobs');
  for (let i = 0; i < 10; i++) { c.advance(1000); u.tick(); }   // 10 s with a recent input
  c.advance(60_000); for (let i = 0; i < 5; i++) { c.advance(1000); u.tick(); }   // then no input: idle
  u.tick(false);   // window hidden: not counted
  u.viewChanged('sessions');
  assert.deepEqual(sent, [{kind: 'screen_time', page: 'jobs', active: 10, idle: 5}]);
  u.viewChanged('focus');
  assert.equal(sent.length, 1, 'a screen with no seconds sends nothing');
});

test('a click is a control name and a whole-percent place; clicks closer than 300 ms are dropped, and unnamed ones never go', () => {
  const c = clock(), sent = [], u = createUsage({send: p => sent.push(p), now: c.now});
  u.viewChanged('jobs');
  assert.equal(u.click({control: 'run-search', x: 500, y: 100, width: 1000, height: 400}), true);
  assert.equal(u.click({control: 'run-search', x: 1, y: 1, width: 1000, height: 400}), false);
  c.advance(400);
  assert.equal(u.click({control: null, x: 1, y: 1, width: 1000, height: 400}), false);
  assert.deepEqual(sent, [{kind: 'ui_click', page: 'jobs', control: 'run-search', x: 50, y: 25}]);
});

test('a control is named by its own attribute or id; text, labels and typing fields are never read', () => {
  const el = (attrs = {}, parent = null, typing = false) => ({getAttribute: n => attrs[n], id: attrs.id || '', parentElement: parent, closest: s => typing ? {} : null});
  const button = el({'data-command': 'find-jobs'}, el({id: 'jobs-toolbar'}));
  assert.equal(controlName(el({}, button)), 'find-jobs');
  assert.equal(controlName(el({'data-command': 'Ada Lovelace CV.pdf'}, el({id: 'Has Space'}))), null, 'a value not in the fixed shape is ignored');
  assert.equal(controlName(el({id: 'answer-box'}, null, true)), null, 'a typing field is never named');
});

test('the main side accepts only the fixed shapes', () => {
  assert.deepEqual(usageEvent({kind: 'screen_time', page: 'jobs', active: 12, idle: 3}), {name: 'screen_time', props: {page: 'jobs', active: 12, idle: 3}});
  assert.deepEqual(usageEvent({kind: 'ui_click', page: 'jobs', control: 'find-jobs', x: 40, y: 7}), {name: 'ui_click', props: {page: 'jobs', control: 'find-jobs', x: 40, y: 7}});
  for (const bad of [null, {}, {kind: 'screen_time', page: 'my private page', active: 1, idle: 1}, {kind: 'screen_time', page: 'jobs', active: -1, idle: 0},
    {kind: 'screen_time', page: 'jobs', active: 99999, idle: 0}, {kind: 'screen_time', page: 'jobs', active: 1.5, idle: 0},
    {kind: 'ui_click', page: 'jobs', control: 'Ada CV', x: 1, y: 1}, {kind: 'ui_click', page: 'jobs', control: 'ok', x: 101, y: 1}, {kind: 'other', page: 'jobs'}]) {
    assert.equal(usageEvent(bad), null, JSON.stringify(bad));
  }
  assert.ok(EVENTS.includes('screen_time') && EVENTS.includes('ui_click'));
});

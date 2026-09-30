// ⌘← / ⌘→ (and ⌘[ / ⌘], the mouse's back/forward buttons): back and forward through the screens you opened
// (renderer/view-history.js; pages/nav.js records each openView).
import assert from 'node:assert/strict';
import test from 'node:test';
import {start, visit, back, forward, navKey} from '../renderer/view-history.js';

test('back and forward walk the screens you opened; a new screen drops the forward ones', () => {
  let h = start('focus');
  h = visit(h, 'jobs'); h = visit(h, 'interviews');
  let step = back(h); assert.equal(step.name, 'jobs'); h = step.history;
  step = back(h); assert.equal(step.name, 'focus'); h = step.history;
  assert.equal(back(h).name, null);  // nothing before the first
  step = forward(h); assert.equal(step.name, 'jobs'); h = step.history;
  h = visit(h, 'settings');  // a new branch: "interviews" is no longer ahead
  assert.equal(forward(h).name, null);
  assert.equal(back(h).name, 'jobs');
});

test('opening the screen you are on is not a new step, and the list stays short', () => {
  let h = start('focus');
  h = visit(h, 'focus');
  assert.equal(back(h).name, null);
  for (let i = 0; i < 80; i += 1) h = visit(h, i % 2 ? 'jobs' : 'focus');
  assert.ok(h.list.length <= 50);
});

test('which key goes back or forward; ⌘←/⌘→ only outside a text box, where they move the cursor', () => {
  const key = (k, extra = {}, editable = false) => navKey({key: k, metaKey: true, ...extra}, {mac: true, editable});
  assert.equal(key('ArrowLeft'), 'back');
  assert.equal(key('ArrowRight'), 'forward');
  assert.equal(key('ArrowLeft', {}, true), null);  // in a text box: start of the line, as always
  assert.equal(key('['), 'back');
  assert.equal(key(']', {}, true), 'forward');  // ⌘[ / ⌘] work even in a text box
  assert.equal(key('ArrowLeft', {shiftKey: true}), null);  // ⇧⌘← selects text
  assert.equal(navKey({key: 'ArrowLeft', altKey: true}, {mac: false, editable: false}), 'back');  // Windows: Alt+←
  assert.equal(navKey({key: 'ArrowLeft', ctrlKey: true}, {mac: true, editable: false}), null);
});

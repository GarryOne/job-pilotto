// ⌘← / ⌘→ (and ⌘[ / ⌘], the mouse's back/forward buttons): back and forward through the screens you opened
// (renderer/view-history.js; pages/nav.js records each openView).
import assert from 'node:assert/strict';
import test from 'node:test';
import {start, visit, back, forward, navKey, openPanel, closePanel, withRun, step} from '../renderer/view-history.js';

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

test('the Recent activity panel is a step: ⌘← opens it again on the run it showed, then the screen under it', () => {
  let h = start('focus');
  h = openPanel(h, 42);
  h = withRun(h, 7);            // you picked another run in it
  h = closePanel(h, 7);         // a press on Jobs in the sidebar closes it first…
  h = visit(h, 'jobs');         // …then Jobs opens: one step, not two
  let s = back(h); assert.deepEqual(step(s.name), {view: 'focus', panel: true, run: 7}); h = s.history;
  s = back(h); assert.deepEqual(step(s.name), {view: 'focus', panel: false, run: null}); h = s.history;
  assert.equal(back(h).name, null);
  s = forward(h); assert.equal(step(s.name).panel, true); h = s.history;
  assert.equal(forward(h).name, 'jobs');
});

test('closing the panel with Escape is a step: ⌘← opens it again; the running task is kept as no run', () => {
  let h = start('jobs');
  h = openPanel(h, null);
  h = closePanel(h, null);
  const s = back(h);
  assert.deepEqual(step(s.name), {view: 'jobs', panel: true, run: null});
  h = openPanel(h, 3);          // opening it again after closing is a step of its own
  assert.equal(h.list.length, 4);
  assert.equal(closePanel(start('focus'), 1).list.length, 1);  // not open through here: nothing to close
});

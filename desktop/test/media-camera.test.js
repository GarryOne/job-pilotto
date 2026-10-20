// The product videos' camera (desktop/scripts/media/camera.mjs): zooms frame each hold's box, clicks pull back so the cursor's trip shows,
// the view never leaves the page, every output frame maps to a recorded frame.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cameraAt, cameraKeys, clipTo, cursorAt, frameAt, MAX_ZOOM, posterTime, renderPlan} from '../scripts/media/camera.mjs';

const viewport = {w: 1800, h: 1125};
const box = {x: 250, y: 500, width: 1200, height: 540};
const log = {viewport, frames: [0, 0.5, 1, 2, 3, 4, 5].map((t, i) => ({t, file: `f${i}.jpg`})),
  events: [{t: 0.2, type: 'hold', box}, {t: 2.5, type: 'click', box: {x: 10, y: 100, width: 100, height: 30}}, {t: 3.2, type: 'press', box: {x: 10, y: 100, width: 100, height: 30}}]};

test('a hold zooms onto its box after a look at the whole screen; a click pulls back to the whole screen', () => {
  const keys = cameraKeys(log);
  const zoomed = keys.find(key => key.z > 1);
  assert.ok(zoomed && zoomed.z <= MAX_ZOOM, 'the hold zooms, within the cap');
  assert.equal(cameraAt(keys, 0.3, viewport).w, viewport.w, 'the whole screen first');
  assert.ok(cameraAt(keys, 2, viewport).w < viewport.w, 'zoomed during the hold');
  assert.equal(cameraAt(keys, 3.6, viewport).w, viewport.w, 'pulled back for the click');
});

test('the view stays inside the page at every moment, and a hold may carry its own zoom (the director\'s plan)', () => {
  const keys = cameraKeys({viewport, events: [{t: 0, type: 'hold', box: {x: 1700, y: 1000, width: 90, height: 90}}]});
  for (let t = 0; t < 3; t += 0.05) {
    const view = cameraAt(keys, t, viewport);
    assert.ok(view.x >= 0 && view.y >= 0 && view.x + view.w <= viewport.w + 1e-9 && view.y + view.h <= viewport.h + 1e-9, `t=${t.toFixed(2)}`);
  }
  const own = cameraKeys({viewport, events: [{t: 0, type: 'hold', box, zoom: 1.2}]});
  assert.equal(own.at(-1).z, 1.2);
  const none = cameraKeys({viewport, events: [{t: 0, type: 'hold', box, zoom: 1}]});
  assert.equal(none.at(-1).z, 1, 'zoom 1 keeps the whole screen');
});

test('the cursor glides to the click target and reaches it at the press; the ring starts at the press', () => {
  const before = cursorAt(log.events, 2.4, viewport), at = cursorAt(log.events, 3.2, viewport), after = cursorAt(log.events, 3.5, viewport);
  assert.equal(before.press, null);
  assert.ok(Math.abs(at.x - 60) < 1 && Math.abs(at.y - 115) < 1, `at the target (${at.x}, ${at.y})`);
  assert.ok(Math.abs(after.press - 0.3) < 1e-9);
});

test('every output frame names a recorded frame at or before its time, at the given rate', () => {
  assert.equal(frameAt(log.frames, 0.75), 1);
  assert.equal(frameAt(log.frames, 99), log.frames.length - 1);
  const plan = renderPlan(log, 10);
  assert.equal(plan.length, 51);
  assert.equal(plan[0].file, 'f0.jpg');
  assert.equal(plan[25].file, 'f3.jpg');
  assert.ok(plan.every(frame => frame.cursor === true));
  assert.equal(renderPlan({...log, events: [{t: 0, type: 'hold', box}]}, 10)[0].cursor, false, 'no clicks: no cursor');
});

test('a close-up\'s crop stays inside the window; one fully outside gives none', () => {
  assert.deepEqual(clipTo({x: -12, y: 900, width: 2000, height: 300}, {w: 1800, h: 1125}), {x: 0, y: 900, width: 1800, height: 225});
  assert.equal(clipTo({x: 1900, y: 0, width: 50, height: 50}, {w: 1800, h: 1125}), null);
});

test('the poster is the end of the hold marked poster (the filled form), else the first frame', () => {
  const events = [{type: 'hold', t: 1, s: 1.2}, {type: 'mark', t: 2.3}, {type: 'hold', t: 3, s: 5, poster: true}, {type: 'hold', t: 8, s: 3.2}];
  assert.equal(posterTime(events), 7.5);
  assert.equal(posterTime(events.map(({poster, ...event}) => event)), 0);
});

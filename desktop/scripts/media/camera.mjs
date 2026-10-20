// The product videos' camera and cursor, as pure functions of the recorder's click log (desktop/scripts/media): where the view zooms, where the
// cursor glides, when a click ring shows. The renderer (render.cjs) draws real recorded frames through this camera, so the app's pixels are never redrawn.
// Coordinates are the page's CSS pixels. Guard: desktop/test/media-camera.test.js.

export const MAX_ZOOM = 1.7;
export const FILL = 0.85;          // a zoomed box fills this share of the view
export const LOOK_HEIGHT = 0.6;    // a tall box (a drawer, a list) is framed by its top part: where the action is
export const ZOOM_IN_DELAY = 0.35; // a hold shows the whole screen this long, then zooms
export const ZOOM_IN = 0.9;        // seconds a zoom takes
export const RING = 0.6;           // seconds a click ring grows and fades

export const ease = x => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };

// log: {viewport: {w, h}, events: [{t, type: 'click'|'press'|'hold', box?, zoom?}]} -> [{t, cx, cy, z}], time-ordered.
// A click pulls back to the whole view (the cursor's trip stays visible); a hold with a box zooms there after a short look at the whole screen.
// A hold may carry its own zoom (the director's plan); 1 keeps the whole view.
export function cameraKeys({viewport, events}) {
  const full = {cx: viewport.w / 2, cy: viewport.h / 2, z: 1};
  const keys = [{t: 0, ...full}];
  for (const event of events) {
    if (event.type === 'click') keys.push({t: event.t, ...full});
    if (event.type !== 'hold' || !event.box) continue;
    const box = {...event.box, height: Math.min(event.box.height, viewport.h * LOOK_HEIGHT)};
    const fit = FILL * Math.min(viewport.w / box.width, viewport.h / box.height);
    const z = Math.max(1, Math.min(MAX_ZOOM, event.zoom ?? fit));
    const cx = box.x + box.width / 2, cy = box.y + Math.min(box.height, viewport.h / z) / 2;
    keys.push({t: event.t + ZOOM_IN_DELAY, ...full}, {t: event.t + ZOOM_IN_DELAY + ZOOM_IN, cx, cy, z});
  }
  return keys.sort((a, b) => a.t - b.t);
}

// The camera at time t: eased between the key before t and the next one; zoom eases geometrically (feels even); the view never leaves the page.
// -> {x, y, w, h}: the page area shown, in CSS px.
export function cameraAt(keys, t, viewport) {
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1] || a;
  const span = Math.max(0.6, Math.min(ZOOM_IN, b.t - a.t));
  const u = b === a ? 1 : t <= a.t ? 0 : ease((t - a.t) / span);
  const z = a.z * (b.z / a.z) ** u, cx = a.cx + (b.cx - a.cx) * u, cy = a.cy + (b.cy - a.cy) * u;
  const w = viewport.w / z, h = viewport.h / z;
  return {x: Math.min(Math.max(cx - w / 2, 0), viewport.w - w), y: Math.min(Math.max(cy - h / 2, 0), viewport.h - h), w, h};
}

// The cursor at time t: at rest, then gliding to each click's target between its 'click' and 'press' events.
// -> {x, y, press}: page CSS px; press = seconds since the last press (null before any), for the click ring.
export function cursorAt(events, t, viewport) {
  let x = viewport.w * 0.62, y = viewport.h * 0.55, press = null;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type !== 'click' || event.t > t || !event.box) continue;
    const pressed = events.slice(i + 1).find(next => next.type === 'press');
    const end = pressed ? pressed.t : event.t + 0.7;
    const u = ease((t - event.t) / Math.max(0.1, end - event.t - 0.08));
    const tx = event.box.x + event.box.width / 2, ty = event.box.y + event.box.height / 2;
    x += (tx - x) * u; y += (ty - y) * u;
    if (pressed && t >= pressed.t) press = t - pressed.t;
  }
  return {x, y, press};
}

// Every output frame of a video at `fps`: which recorded frame, the page area shown, the cursor. What render.cjs draws. Pure.
// log: {viewport, frames: [{t, file}], events}. cursor: false hides it (a piece with no clicks).
// The poster's moment: the end of the hold marked poster (the filled form, ready to submit), else the first frame. Pure.
export function posterTime(events = []) {
  const hold = events.find(event => event.type === 'hold' && event.poster);
  return hold ? Number((hold.t + hold.s * 0.9).toFixed(2)) : 0;
}

export function renderPlan(log, fps = 30) {
  const keys = cameraKeys(log), end = log.frames.at(-1).t, cursor = log.events.some(event => event.type === 'click');
  const out = [];
  for (let i = 0; i <= Math.floor(end * fps); i++) {
    const t = i / fps, view = cameraAt(keys, t, log.viewport), at = cursorAt(log.events, t, log.viewport);
    out.push({file: log.frames[frameAt(log.frames, t)].file, ...view, cx: at.x, cy: at.y, press: at.press, cursor});
  }
  return out;
}

// The frame shown at time t: the last recorded frame at or before t (frames: [{t}] in time order). -> index.
export function frameAt(frames, t) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

// A crop inside the window (a card may reach past its edge). -> null when nothing is left. Pure.
export function clipTo(box, view) {
  const x = Math.max(0, box.x), y = Math.max(0, box.y), width = Math.min(view.w, box.x + box.width) - x, height = Math.min(view.h, box.y + box.height) - y;
  return width >= 1 && height >= 1 ? {x, y, width, height} : null;
}

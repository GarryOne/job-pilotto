// The one overlay the app shows at a time: Recent activity and a job's drawer take turns, never stack (owner, 10 Oct 2026). Each registers
// how to close and reopen itself; opening one closes the other and says which it displaced, so "Back to Recent activity" can reopen it.
const surfaces = new Map();

export function registerOverlay(name, {close, open}) { surfaces.set(name, {close, open, shown: false}); }

// `name` is about to show: whatever else is showing closes. Returns the name it displaced, or ''.
export function claimOverlay(name) {
  let displaced = '';
  for (const [other, surface] of surfaces) {
    if (other === name || !surface.shown) continue;
    displaced = other;
    surface.close();
  }
  if (surfaces.has(name)) surfaces.get(name).shown = true;
  return displaced;
}

export function releaseOverlay(name) { if (surfaces.has(name)) surfaces.get(name).shown = false; }
export function reopenOverlay(name) { surfaces.get(name)?.open(); }

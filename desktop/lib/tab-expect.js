// What the app expects after it opens a form tab: the extension binds that tab to its session within a window. It resolves as "taken"; when it
// doesn't, one report names the step that failed (the extension silent, or alive but not on the tab); a Review in form that got no page answer
// reports its own step. An expectation exists only because the app opened the tab, so a tab the person opened never reports. Cancelled sessions,
// and windows the app slept through, never report. Reports go to the Technical reports as kind "tab" (lib/telemetry.js, site/src/telemetry.js).
// Guard: test/tab-expect.test.js.
export const WINDOW_MS = 20000, SILENT_MS = 90000, TICK_MS = 5000;
const SLEPT_MS = 3 * TICK_MS;   // a tick later than this: the app was asleep or busy, not the extension

export function createTabExpect({now = Date.now, record, isBound, isLive, extensionSeen}) {
  const waiting = new Map();   // session id -> when the tab was opened
  let last = now();
  return {
    expect(id) { waiting.set(String(id), now()); },
    miss(outcome) { record({outcome}); },   // a Review in form no page answered: wake_failed or join_empty
    tick() {
      const t = now(), gap = t - last;
      last = t;
      for (const [id, at] of [...waiting]) {
        if (!isLive(id)) { waiting.delete(id); continue; }
        if (isBound(id)) { waiting.delete(id); record({outcome: 'taken', ms: t - at}); continue; }
        if (gap > SLEPT_MS) { waiting.set(id, at + gap); continue; }   // the window did not run while the app slept
        if (t - at < WINDOW_MS) continue;
        waiting.delete(id);
        const seen = extensionSeen();
        record({outcome: !seen || t - seen.at > SILENT_MS ? 'extension_silent' : 'tab_not_taken', ms: t - at});
      }
    },
  };
}

// The one tracker of this app (started by lib/telemetry-handlers.js once reporting is on); without it every call is a no-op, as in tests.
let tracker = null;
export function startTracking(deps, {setTimer = setInterval} = {}) {
  tracker = createTabExpect(deps);
  setTimer(() => tracker.tick(), TICK_MS)?.unref?.();
  return tracker;
}
export const expectTab = id => tracker?.expect(id);
export const noteTabMiss = outcome => tracker?.miss(outcome);

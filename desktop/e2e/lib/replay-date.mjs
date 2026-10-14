// The replay's page clock (14 Oct 2026): the page sees the live run's DATE (Date, Date.now) flowing from the record's start, while its timers stay real.
// Playwright's clock.install also fakes setTimeout/setInterval/requestAnimationFrame: Databricks' OneTrust banner then showed on the replay (never live) and every
// AI ask after it missed (0/8); with real timers it replays 8/8 as live. Guard: e2e/test/replay-date.test.mjs. Used by replay-net.mjs.

// The script the page runs first: Date shifted by a fixed offset (computed once in node, so time flows on across pages and frames), nothing else touched.
export function dateShiftScript({offset}) {
  const Real = Date;
  if (Real.__jpShifted) return;
  class Shifted extends Real {
    constructor(...args) { if (args.length === 0) super(Real.now() + offset); else super(...args); }
    static now() { return Real.now() + offset; }
  }
  Object.defineProperty(Shifted, '__jpShifted', {value: true});
  globalThis.Date = Shifted;
}

// Shifts every page and frame of the context to the record's start time (ms). -> the offset in ms.
export async function shiftDate(context, startMs, now = Date.now()) {
  const offset = Math.round(startMs - now);
  await context.addInitScript(dateShiftScript, {offset});
  return offset;
}

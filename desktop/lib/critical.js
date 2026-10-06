// Work that quitting must not cut off half-way: an export, a Notion workspace being built, archived or filled, Always on or the Telegram buttons
// being set up, a CV or an interview being saved. The quit check (lifecycle.js) names it and offers to wait (6 Oct 2026: the app closed during an
// export without asking). Searches, queued tasks and Apply sessions have their own tracking (pipeline, terminals).
const running = new Map();
let next = 0, waiters = [];

// Runs work() and keeps `label` in the list while it runs; returns what work() returns (or throws what it throws).
export function during(label, work) {
  const id = ++next;
  running.set(id, label);
  return Promise.resolve().then(work).finally(() => {
    running.delete(id);
    if (!running.size) { const done = waiters; waiters = []; done.forEach(resolve => resolve()); }
  });
}

// What is running now, once each ("Exporting your data").
export const labels = () => [...new Set(running.values())];

export const whenDone = () => running.size ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve();

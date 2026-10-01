// The alarm that reports a tab's state every 30 seconds. Chrome keeps an alarm across service-worker restarts — and
// creating an alarm that already exists *resets* its timer. The worker is woken by other events far more often than
// every 30 seconds, so `chrome.alarms.create(...)` at the top level of the worker kept pushing the alarm out of
// reach: the tab report could go a long time without ever firing (1 Oct 2026). Create it only when it is missing.
//
// Kept free of chrome.* so the decision can be tested: `get` and `create` are passed in.
export function ensureAlarm({get, create, name = 'report-tabs', periodInMinutes = 0.5}) {
  return Promise.resolve()
    .then(() => get(name))
    .then(existing => (existing ? false : Promise.resolve(create(name, {periodInMinutes})).then(() => true)))
    .catch(() => false);   // no alarms API at all: the extension still reports when the worker starts
}

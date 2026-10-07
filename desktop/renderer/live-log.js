// The running task's live log in the window: the app (lib/pipeline.js current.log, its last 300 lines) is the copy that lasts; the window's own
// list only adds the lines that arrived since. 7 Oct 2026: reopening Recent activity during a search left one line ("⏳ Still running"), because
// the window's list had been cleared and was preferred to the app's as soon as it held anything.
export function seeded(appLog, windowLines) {
  const kept = Array.isArray(appLog) ? appLog : [];
  return kept.length > windowLines.length ? [...kept] : windowLines;
}

// Whether the extension is stopped, and the one door the debugger goes through (extension/stop.js says why and does the stopping). A leaf with no imports on purpose: the files that
// act (the fill, the presses, the debugger users) check it without pulling the worker in. Guard: desktop/test/extension-stop.test.js.
let stoppedAt = 0;
export const isStopped = () => stoppedAt > 0;
export const mayAct = () => stoppedAt === 0;
export const markStopped = when => { stoppedAt = when; };
// The person starts it again (Apply in the app, the panel's Fill, the popup's Apply on this page). -> whether it was stopped.
export function restart() {
  if (!stoppedAt) return false;
  stoppedAt = 0;
  chrome.storage.session.remove('stopped').catch(() => {});
  return true;
}
// The one place the debugger is attached (it shows Chrome's "started debugging this browser" bar): never while stopped, and only on a tab the app opened for an application.
export async function attachDebugger(tabId) {
  if (isStopped()) throw new Error('stopped: the person pressed Stop');
  const key = `armed:${tabId}`;
  let armed = !!(await chrome.storage.session.get(key).catch(() => ({})))[key];
  if (!armed) armed = String((await chrome.tabs.get(tabId).catch(() => null))?.url || '').includes('#jobpilotto-fill');
  if (!armed) throw new Error('not one of the tabs the app opened for an application');
  await chrome.debugger.attach({tabId}, '1.3');
}

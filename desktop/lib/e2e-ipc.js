// E2E only: wraps ipcMain.handle so every call the window makes to the app is logged (channel, start, duration, failed), newest MAX kept. The journey reads the log to tell a
// click that reached nothing from one that worked, and an action that ran for seconds with no sign of work.
const MAX = 400;

export function recordIpc(handle, log, max = MAX) {
  return (channel, fn) => handle(channel, (event, ...args) => {
    const entry = {channel, start: Date.now(), ms: null};
    log.push(entry);
    if (log.length > max) log.splice(0, log.length - max);
    const done = failed => { entry.ms = Date.now() - entry.start; if (failed) entry.failed = true; };
    let result;
    try { result = fn(event, ...args); } catch (error) { done(true); throw error; }
    if (result && typeof result.then === 'function') return result.then(value => { done(false); return value; }, error => { done(true); throw error; });
    done(false);
    return result;
  });
}

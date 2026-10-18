// Ready to send by itself (owner, 18 Oct 2026: "before I turn off the laptop"; he chose "on change + at shutdown"): tonight's finished jobs go to
// the server whenever their list changes (checked every few minutes and when the screen locks), and once more when the app quits, the Mac sleeps
// or shuts down, so the night runs with the laptop off. Never after tonight's fill time, never over a night already started (Fill now), only on
// the owner's install. Wired in lib/ready-handlers.js. Guard: test/ready-auto.test.js.
import {nightOf} from './ready-batch.js';

export const CHECK_EVERY_MS = 5 * 60 * 1000;
const QUIT_WAIT_MS = 15000;   // a quit waits at most this long for the last send

// deps: {storage, eligible() -> bool, tonightCodes() -> [code], sendNow() -> {ok, queued}, now() -> Date, log(message, extra)}.
// -> {check(why): sends when tonight's list differs from the one last sent, one at a time, never throws; record(codes, result): a send made by hand}.
export function createAutoSend({storage, eligible, tonightCodes, sendNow, now = () => new Date(), log = () => {}}) {
  let running = null;
  const ready = () => storage.settings().ready || {};
  // A send made by hand (Fill tonight): recorded, so the next check knows it is up to date and does not send it again.
  const record = (codes, result, at = now()) => {
    if (result?.ok) storage.saveSettings({ready: {...ready(), sent: {sig: `${nightOf(at).night}:${[...codes].sort().join(',')}`, night: nightOf(at).night, count: result.queued, at: at.toISOString()}}});
  };
  async function once(why) {
    if (!eligible()) return {skipped: 'not the owner\'s own app'};
    const at = now(), {night, fillAt} = nightOf(at);
    if (at >= new Date(fillAt)) return {skipped: 'tonight\'s fill time has passed'};
    if (ready().ranNight === night) return {skipped: 'tonight\'s night already started'};
    const codes = [...(await tonightCodes())].sort();
    if (!codes.length) return {skipped: 'no finished job'};
    const sig = `${night}:${codes.join(',')}`;
    if (ready().sent?.sig === sig) return {skipped: 'up to date'};
    const result = await sendNow();
    record(codes, result, at);
    log(`sent by itself (${why})`, {ok: !!result?.ok, jobs: codes.length, error: result?.ok ? undefined : result?.error});
    return result;
  }
  const check = why => {
    running ||= once(why).catch(error => { log(`could not send (${why})`, {error: error.message}); return {ok: false, error: error.message}; }).finally(() => { running = null; });
    return running;
  };
  return {check, record};
}

// Electron's hooks: a timer, the screen lock, sleep, shutdown and the app's quit. app and powerMonitor come from main; absent (tests): nothing starts.
export function startAutoSend(check, {app, powerMonitor, every = CHECK_EVERY_MS, quitWait = QUIT_WAIT_MS} = {}) {
  if (!app || !powerMonitor) return () => {};
  const timer = setInterval(() => check('every few minutes'), every), first = setTimeout(() => check('app start'), 60000);
  timer.unref?.(); first.unref?.();
  powerMonitor.on('lock-screen', () => check('screen locked'));
  powerMonitor.on('suspend', () => check('the Mac sleeps'));
  powerMonitor.on('shutdown', event => { event.preventDefault?.(); withLimit(check('the Mac shuts down'), quitWait).then(() => app.quit()); });
  let lastDone = false;
  app.on('before-quit', event => {
    if (lastDone || event.defaultPrevented) return;   // the app's own quit check asked first: its next quit comes back here
    event.preventDefault();
    withLimit(check('the app quits'), quitWait).then(() => { lastDone = true; app.quit(); });
  });
  return () => { clearInterval(timer); clearTimeout(first); };
}

const withLimit = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);

// The silent dead-end rule (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 2: "ONE rule, no list"): an application with no progress for SILENT_AFTER_MS whose run
// has not ended is a dead end the run did not admit. Progress is ladder/progress.js's fixed kinds only: activity without progress (a press, an AI ask) never restarts the clock. The run has
// ended when the door spoke (ladder/dead-end.js deadEnd: every stop, the person-stops among them) or the page was handed to the person (form-ready.js: ready on the final step, so
// Submit is theirs, or needs_person). Per APPLICATION (its job), not per tab: Apply opening a new tab moves the application on, it never leaves the posting tab "silent".
// In SHADOW: a silence is noted once (progress.js hands the notice to the door, {shadow: true}); nothing else happens. The clock lives in the worker: a worker that sleeps forgets it
// (a miss is today's behaviour). Pure apart from its timer, so the CI pool's logs are read with the same rule. Guard: worker/test/silence.test.js.

// T, PROVISIONAL: 30 s (the spec's start ~20 s, above the old coarse baseline's p95 of 22 s) until the CI pool's gaps between progress notes set it
// (desktop/e2e/pool-gaps.mjs): it must sit above the slowest normal gap.
export const SILENT_AFTER_MS = 30000;

// The rule: a clock {at, ended, noticed} is silent at `now` when nothing ended it, it was not noted yet, and its last progress is T old.
export const isSilent = (clock, now, T = SILENT_AFTER_MS) => !!clock && !clock.ended && !clock.noticed && now - clock.at >= T;
// The form judge's answer that hands the page to the person (desktop/lib/form-judge.js): their choice is needed, or the form is ready on its final step (Submit is theirs).
export const handedToPerson = answer => answer?.answer === 'needs_person' || (answer?.answer === 'ready' && answer?.step === 'final');

const jobs = new Map();   // tabId -> the application (its job, without the #part) the tab works on
const clocks = new Map();   // application -> {at, kind, host, ended, noticed, timer}
let notice = () => {};
let timer = (fn, ms) => { const id = setTimeout(fn, ms); id?.unref?.(); return id; };
let cancel = id => clearTimeout(id);
// parts: {notice(host, evidence)} (progress.js: the door), and for the tests {timer, cancel}.
export function useSilence(parts = {}) {
  if (parts.notice) notice = parts.notice;
  if (parts.timer) timer = parts.timer;
  if (parts.cancel) cancel = parts.cancel;
}
const appOf = tabId => jobs.get(tabId) || `tab ${tabId}`;
const stop = clock => { if (clock?.timer != null) cancel(clock.timer); if (clock) clock.timer = null; };

// Which application a tab works on (progress.js, at each page the fill flow considers).
export function silenceTab(tabId, job) {
  const key = String(job || '').split('#')[0];
  if (tabId != null && key) jobs.set(tabId, key);
}

function check(app, now) {
  const clock = clocks.get(app);
  if (!isSilent(clock, now)) return false;
  clock.noticed = true;
  notice(clock.host, {kind: clock.kind, silentMs: now - clock.at});
  return true;
}
export const checkSilence = (tabId, now = Date.now()) => check(appOf(tabId), now);

// A progress note (progress.js): the application's clock starts again, checked T from now. host: the page's, when the note knows it (a new page), else the last one.
export function restartSilence(tabId, kind, {now = Date.now(), host = ''} = {}) {
  if (tabId == null) return;
  const app = appOf(tabId), before = clocks.get(app);
  stop(before);
  const clock = {at: now, kind, host: host || before?.host || '', ended: false, noticed: false, timer: null};
  clocks.set(app, clock);
  clock.timer = timer(() => check(app, Date.now()), SILENT_AFTER_MS);
}
// The run ended for this tab's application (the door spoke, or the page was handed to the person): the silence from here on is expected.
export function endSilence(tabId) {
  const clock = clocks.get(appOf(tabId));
  if (clock) { clock.ended = true; stop(clock); }
}
// A closed tab: its application's clock goes once no other tab works on it.
export function forgetSilence(tabId) {
  const app = appOf(tabId);
  jobs.delete(tabId);
  if ([...jobs.values()].includes(app)) return;
  stop(clocks.get(app));
  clocks.delete(app);
}
export const silenceOf = tabId => {
  const clock = clocks.get(appOf(tabId));
  return clock ? {at: clock.at, kind: clock.kind, host: clock.host, ended: clock.ended, noticed: clock.noticed} : null;
};

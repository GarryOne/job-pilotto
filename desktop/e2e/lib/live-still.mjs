// When a live run may end before its limit: the page (and what the app logs about it) has not changed for STILL seconds (11 Oct 2026, owner: "end a live run 20 s after the
// page last changed, keep 90 s as the limit"). A still page is the end of the story: a held run waits for nothing more. A page that is only slow (a form drawn after a spinner,
// a model answering) changes its tabs, its controls or the app's log, which moves the clock. LIVE_STILL_SECONDS=0 turns it off. Guard: test/live-still.test.mjs.
export const STILL_SECONDS = 20;
export const stillSeconds = (env = process.env) => (env.LIVE_STILL_SECONDS === undefined || env.LIVE_STILL_SECONDS === '' ? STILL_SECONDS : Math.max(0, Number(env.LIVE_STILL_SECONDS) || 0));

// What the clock watches: the tabs and fill states, the session's stage, the page's visible shape (url, title, how many controls and buttons), how many log lines the app wrote.
export const signature = ({states = [], stage = '-', status = '-', shape = '', logLines = 0} = {}) => JSON.stringify([states, stage, status, shape, logLines]);

// -> {see(sig, at), stillFor(at), over(at, {opened})}: `at` in ms. The run may end only once the posting has been opened in the browser (before that, "Apply never opened" is its own failure).
export function stillClock({seconds = STILL_SECONDS, startedAt = 0} = {}) {
  let last = '', changedAt = startedAt;
  return {
    see(sig, at) { if (sig !== last) { last = sig; changedAt = at; return true; } return false; },
    stillFor: at => at - changedAt,
    over: (at, {opened = false} = {}) => seconds > 0 && opened && at - changedAt >= seconds * 1000,
  };
}

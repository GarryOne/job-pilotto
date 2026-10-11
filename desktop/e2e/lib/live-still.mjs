// When a live run may end before its limit: the page (and what the app logs about it) has not changed for STILL seconds (11 Oct 2026, owner: "end a live run 20 s after the
// page last changed, keep 90 s as the limit"). A still page is the end of the story: a held run waits for nothing more. A page that is only slow (a form drawn after a spinner,
// a model answering) changes its tabs, its controls or the app's log, which moves the clock. LIVE_STILL_SECONDS=0 turns it off. Guard: test/live-still.test.mjs.
export const STILL_SECONDS = 20;
export const STILL_SECONDS_CLI = 45;   // plan-path (claude -p) asks take 5-12 s each: 20 s of quiet ended runs while the AI was still thinking, a false "form empty" (11 Oct 2026)
export const stillSeconds = (env = process.env, engine = '') => (env.LIVE_STILL_SECONDS === undefined || env.LIVE_STILL_SECONDS === '' ? (engine === 'cli' ? STILL_SECONDS_CLI : STILL_SECONDS) : Math.max(0, Number(env.LIVE_STILL_SECONDS) || 0));

// What the clock watches: the tabs and fill states, the session's stage, the page's visible shape (url, title, how many controls and buttons), how many log lines the app wrote.
export const signature = ({states = [], stage = '-', status = '-', shape = '', logLines = 0} = {}) => JSON.stringify([states, stage, status, shape, logLines]);

// -> {see(sig, at), stillFor(at), over(at, {opened})}: `at` in ms. The run may end only once the posting has been opened in the browser (before that, "Apply never opened" is its own failure).
export function stillClock({seconds = STILL_SECONDS, startedAt = 0} = {}) {
  let last = '', changedAt = startedAt;
  return {
    see(sig, at) { if (sig !== last) { last = sig; changedAt = at; return true; } return false; },
    stillFor: at => at - changedAt,
    over: (at, {opened = false, deciding = false} = {}) => seconds > 0 && opened && !deciding && at - changedAt >= seconds * 1000,   // deciding: the extension's own step line is up (lib/deciding.mjs): the limit, not the quiet window, ends the run
  };
}

// How many of the app's log lines are about the page and the fill (the extension's, the review's, the page-kind's): the app's own heartbeat (a store call every 15 s) is not news.
export const PAGE_LINE = /\[(extension|review|page-kind|applied|misses)\]/;
export const pageLines = lines => lines.filter(line => PAGE_LINE.test(line)).length;

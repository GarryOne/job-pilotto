// Following the live run in a row replay (speed-5x landing 2): a recorded page has no scripts, so what the site did after a press (a dialog its script opened, a
// route it changed, a banner it closed) is played back from the live run's own states (lib/capture-journey.mjs: each settled state in order, with its time) once
// the replay's extension makes the same press as the live run did at that point (presses.json, lib/replay-candidate.mjs livePresses). A different press stops the
// replay: "pressed X, live pressed Y" is the finding a fix needs. Used by lib/row-replay.mjs. Guard: e2e/test/row-follow.test.mjs.

// The presses the replay's extension logged (its /extension/log calls, our own wording), in order. -> [{what, label}]
const PRESS = /^((?:pressed [^:]*?|closed a popup))(?::.*)?$/;   // words-ok: our own log's wording, not page text
export function replayPresses(requests, hosts = null) {   // hosts: only this row's presses (each press line names its host), when rows replay side by side
  const presses = [];
  for (const request of requests.filter(item => item.route === '/extension/log')) {
    let entries = [];
    try { entries = JSON.parse(request.body).entries || []; } catch { continue; }   // a body cut at the recording limit
    for (const entry of entries) {
      const text = String(entry.text || '').replace(/^[a-z-]+: /, ''), found = text.match(PRESS);
      if (found && (!hosts || !entry.fields?.host || hosts.has(String(entry.fields.host)))) presses.push({what: found[1].trim(), label: String(entry.fields?.label || '')});
    }
  }
  return presses;
}

// The main page's state the live run reached after its press `k` (between that press and the next one: the one kept at the extension's ask, else the first), or null.
// A popup the live run closed BEFORE its first kept page (a cookie banner: the capture's first page is the one after it, without the banner) cannot be pressed by the replay, whose page never offers it:
// it is not part of the journey the replay follows (12 Oct 2026, Teamtailor: the replay's first press was Apply, the live run's the banner, so it diverged at press 1). firstAt: the time of the first kept page.
export const keptPresses = (presses, firstAt) => (firstAt == null ? presses : presses.filter(press => !(press.what === 'closed a popup' && press.at < firstAt)));

// k = -1: before any press (the segment the page starts in; its state is the page as the extension saw it when it asked).
const segment = (states, presses, k) => {
  const after = k < 0 ? -Infinity : presses[k]?.at, before = presses[k + 1]?.at ?? Infinity;
  return after == null ? [] : states.filter(state => state.at > after && state.at < before);
};
export function stateAfter(states, presses, k) {
  const window = segment(states, presses, k);
  return window.find(state => state.ask) || (k < 0 ? null : window[0]) || null;   // the page as the extension saw it when it asked, else the first state kept after the press
}

// The states the page reached on its own in that segment after the one stateAfter serves (the site's script reacting to the extension: an attached CV autofilled the form and emptied the boxes the
// extension had typed, Ashby, 12 Oct 2026). One follows per extension action (an attach, lib/row-replay.mjs), so a row with 0 presses reaches them too. A copy of the page just before it is not a new state.
export function laterStates(states, presses, k) {
  const window = segment(states, presses, k), first = stateAfter(states, presses, k) || window[0];
  if (!first) return [];
  const later = [];
  for (const state of window.filter(one => one.at > first.at)) if (state.html !== (later.at(-1) || first).html) later.push(state);
  return later;
}

// Press `k` of the replay against the live run's: -> {same: true} or {same: false, finding}.
export function samePress(mine, live, k) {
  if (!live) return {same: false, finding: `pressed "${mine.label}" (${mine.what}); the live run pressed nothing more`};
  if (mine.what === live.what && mine.label === live.label) return {same: true};
  return {same: false, finding: `press ${k + 1}: pressed "${mine.label}" (${mine.what}); live pressed "${live.label}" (${live.what})`};
}

// Runs in the page: the recorded next state of this same address replaces the page's own content, the extension's own UI (ids jobpilotto-*) kept.
export function swapInPage(html) {
  /* global document, DOMParser */
  const next = new DOMParser().parseFromString(html, 'text/html'), ours = [...document.querySelectorAll('[id^=jobpilotto], [id^=job-pilotto]')];
  document.head.innerHTML = next.head.innerHTML;
  document.body.replaceChildren(...next.body.childNodes, ...ours);
  document.title = next.title;
}

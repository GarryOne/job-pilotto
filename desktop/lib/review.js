// The form page and the session page, in step. The Chrome extension shows a ring on the application form (how much
// is left before you can submit) and reports it here; the session page shows the same, ticks off the agreements you
// tick in the form, and its "Open the form to tick it" makes the page scroll to that field.
//   page -> app  POST /extension/review {url, title, left, total, missing: [label], filled: [label], watch: [{id, filled: true|false|null}]}
//   app -> page  the reply: {matched, watch: [{id, label}], commands: [{focus: label}]}
import fs from 'node:fs';
import {scoreTab} from './form-tab.js';

const MIN_SCORE = 50;          // the company in the title or an application-form host naming it, at least
const COMMAND_SECONDS = 120;   // a "show me this field" waits this long for the page to pick it up
const watches = new Map();     // session id -> [{id, label}] the app wants tracked in the form
const commands = new Map();    // session id -> [{focus, at}]
const last = new Map();        // session id -> the last state passed on
const waiting = new Map();     // session id -> resolvers waiting for a page to take a "show me this field"
let reporter = () => {};
let keptFile = '';             // the last states, on disk: a restarted app shows "Ready to submit" before the page reports again

// Load the saved states (only for sessions that still exist), then save every change.
export function persist(file, sessionIds = null) {
  keptFile = file;
  try {
    for (const state of JSON.parse(fs.readFileSync(file, 'utf8'))) if (state?.id && (!sessionIds || sessionIds.includes(state.id))) last.set(state.id, state);
  } catch {}
}
function save() {
  if (!keptFile) return;
  try { fs.writeFileSync(keptFile, JSON.stringify([...last.values()]), {mode: 0o600}); } catch {}
}
export const setReporter = fn => { reporter = fn; };

// The session a form page belongs to: the best match by the job's URL, ID, company and site; the later start wins a tie.
export function matchSession(sessions, page) {
  let best = null, bestScore = 0;
  for (const session of sessions) {
    const score = scoreTab(page, {url: session.url, company: session.company});
    if (score >= MIN_SCORE && (score > bestScore || (score === bestScore && best && session.startedAt > best.startedAt))) { best = session; bestScore = score; }
  }
  return best;
}

export function setWatch(id, items) {
  watches.set(id, (Array.isArray(items) ? items : []).filter(item => item?.id && item?.label).map(({id: key, label}) => ({id: String(key), label: String(label)})));
}
// "Close this form": the page answering it closes its own tab (the application was cancelled).
export function queueClose(id, now = Date.now()) {
  commands.set(id, [...(commands.get(id) || []).filter(c => now - c.at < COMMAND_SECONDS * 1000), {close: true, at: now}]);
}
export function queueFocus(id, label, now = Date.now()) {
  commands.set(id, [...(commands.get(id) || []).filter(c => now - c.at < COMMAND_SECONDS * 1000), {focus: String(label), at: now}]);
}
// Resolves true once a form page took this session's "show me this field", false after ms (no page with the
// extension answered: the extension isn't on that tab, or the tab is closed).
export function delivered(id, ms = 7000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { waiting.set(id, (waiting.get(id) || []).filter(fn => fn !== done)); resolve(false); }, ms);
    const done = () => { clearTimeout(timer); resolve(true); };
    waiting.set(id, [...(waiting.get(id) || []), done]);
  });
}

// The page's report. Returns what the page needs back: the session it matched, what to track, what to show.
export function report(sessions, payload, now = Date.now()) {
  const page = {url: String(payload?.url || ''), title: String(payload?.title || '')};
  const session = matchSession(sessions, page);
  if (!session) return {matched: null, session: null, watch: [], commands: []};
  const states = {};
  for (const item of Array.isArray(payload.watch) ? payload.watch : []) if (typeof item?.filled === 'boolean') states[String(item.id)] = item.filled;
  const state = {id: session.id, url: page.url.split(/[?#]/)[0].slice(0, 300), left: Math.max(0, Number(payload.left) || 0), total: Math.max(0, Number(payload.total) || 0), states,
    missing: (Array.isArray(payload.missing) ? payload.missing : []).slice(0, 30).map(label => String(label).slice(0, 120)).filter(Boolean)};
  // What's left as the ring counts it (an older extension sends only the required ones, as missing).
  if (Array.isArray(payload.pending)) state.pending = payload.pending.slice(0, 30).map(label => String(label).slice(0, 120)).filter(Boolean);
  state.ready = state.total > 0 && state.left === 0;
  // Each field ticked off with the time it was first seen filled: the Applying page's "In the form" list.
  const seen = new Map((last.get(session.id)?.filled || []).map(item => [item.label, item.at]));
  if (Array.isArray(payload.filled)) state.filled = payload.filled.slice(0, 40).map(label => String(label).slice(0, 120)).filter(Boolean)
    .map(label => ({label, at: seen.get(label) ?? now}));
  if (JSON.stringify(last.get(session.id)) !== JSON.stringify(state)) { last.set(session.id, state); save(); reporter({...state, at: now}); }
  const due = (commands.get(session.id) || []).filter(c => now - c.at < COMMAND_SECONDS * 1000);
  commands.delete(session.id);
  if (due.length) { for (const done of waiting.get(session.id) || []) done(); waiting.delete(session.id); }
  // The panel's header: which job this is and what Claude is doing on it (no answers, no personal data).
  const about = {id: session.id, url: session.url, title: session.title || '', company: session.company || '', status: session.status,
    note: session.note || '', live: session.live ?? !session.endedAt};
  return {matched: session.id, session: about, watch: watches.get(session.id) || [], commands: due.map(({focus, close}) => (close ? {close: true} : {focus}))};
}
// Every form's last state, for a window that just loaded (⌘R) and missed them: they're passed on only when they change.
export const allStates = () => [...last.values()];
export const _reset = () => { keptFile = ''; watches.clear(); commands.clear(); last.clear(); waiting.clear(); reporter = () => {}; };  // tests

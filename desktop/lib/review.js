// The form page and the session page, in step. The Chrome extension shows a ring on the application form (how much
// is left before you can submit) and reports it here; the session page shows the same, ticks off the agreements you
// tick in the form, and its "Open the form to tick it" makes the page scroll to that field.
//   page -> app  POST /extension/review {url, title, left, total, missing: [label], filled: [label], watch: [{id, filled: true|false|null}]}
//   app -> page  the reply: {matched, watch: [{id, label}], commands: [{focus: label}]}
import fs from 'node:fs';
import {ATS, scoreTab} from './form-tab.js';

const MIN_SCORE = 50;          // the company in the title or an application-form host naming it, at least
const COMMAND_SECONDS = 120;   // a "show me this field" waits this long for the page to pick it up
const watches = new Map();     // session id -> [{id, label}] the app wants tracked in the form
const commands = new Map();    // session id -> [{focus, at}]
const last = new Map();        // session id -> the last state passed on
const waiting = new Map();     // session id -> resolvers waiting for a page to take a "show me this field"
const focusAnswers = new Map(); // session id -> whether the page found the field the app asked to show
const focusWaiters = new Map(); // session id -> resolvers waiting for that answer
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
// A page that says which job its tab was opened for (the extension remembers it, even when the form sits on another site
// than the posting: an agency's own form behind "Apply", a company that isn't named) belongs to that job's session, first.
const jobKey = url => String(url || '').split('#')[0].replace(/\/+$/, '');
export function matchSession(sessions, page) {
  let best = null, bestScore = 0;
  for (const session of sessions) {
    const score = page.job && jobKey(page.job) === jobKey(session.url) ? 100 : scoreTab(page, {url: session.url, company: session.company});
    if (score >= MIN_SCORE && (score > bestScore || (score === bestScore && best && session.startedAt > best.startedAt))) { best = session; bestScore = score; }
  }
  return best;
}

// A form the fill mark names but nothing else does (an agency's own form behind the posting, the company not named, the
// extension unsure which job opened the tab): it belongs to the one open session no other tab is bound to. Two such
// sessions, or none, and it stays unmatched: a guess would put one job's form on another's card.
export function sessionFor(sessions, page, tab) {
  const scored = matchSession(sessions, page);
  if (scored || !String(page.url || '').includes('jobpilotto-fill')) return scored;
  // A form on a known job board is some other job's (it would have matched by its job ID or company): left alone, or a stray
  // tab of a finished application (1 Oct 2026: a Scale AI form) lands on this card.
  let host = '';
  try { host = new URL(page.url).hostname; } catch { return scored; }
  if (ATS.test(host)) return scored;
  const free = sessions.filter(session => ['running', 'input'].includes(session.status)
    && (!bound.has(session.id) || (Number.isInteger(tab) && bound.get(session.id) === tab)));
  return free.length === 1 ? free[0] : null;
}

export function setWatch(id, items) {
  watches.set(id, (Array.isArray(items) ? items : []).filter(item => item?.id && item?.label).map(({id: key, label}) => ({id: String(key), label: String(label)})));
}
// "Close this form": the page answering it closes its own tab (the application was cancelled).
export function queueClose(id, now = Date.now()) {
  commands.set(id, [...(commands.get(id) || []).filter(c => now - c.at < COMMAND_SECONDS * 1000), {close: true, at: now}]);
}
// "Reload the page you are on": the panel does it itself (the repair for a panel that died with an older
// extension instance), so it works in whatever browser that panel is running in.
export function queueReload(id, now = Date.now()) {
  commands.set(id, [...(commands.get(id) || []).filter(c => now - c.at < COMMAND_SECONDS * 1000), {reload: true, at: now}]);
}
// A "show me this field" nobody picked up: dropped, so the page doesn't act on it minutes later and pull Chrome forward.
export function cancelFocus(id) {
  const rest = (commands.get(id) || []).filter(command => command.focus === undefined);
  if (rest.length) commands.set(id, rest); else commands.delete(id);
}
export function queueFocus(id, label, now = Date.now()) {
  focusAnswers.delete(id);
  commands.set(id, [...(commands.get(id) || []).filter(c => now - c.at < COMMAND_SECONDS * 1000), {focus: String(label), at: now}]);
}
// Tabs the extension should join (inject the panel, do not reload) because a session is waiting to show a field
// and no page has answered yet. The match is the same one a reporting page uses, so it never joins a stranger's tab.
export function tabsToArm(sessions, tabs, now = Date.now()) {
  const pending = (sessions || []).filter(session => (commands.get(session.id) || []).some(command => now - command.at < COMMAND_SECONDS * 1000));
  const urls = [];
  for (const tab of tabs || []) {
    if (!tab?.url || !sessionFor(pending, {url: tab.url, title: tab.title || ''}, NaN)) continue;
    urls.push(String(tab.url).split('#')[0]);
  }
  return [...new Set(urls)];
}
// The page scrolled, or looked and found no such field. Resolves whoever is waiting; kept if they ask just after.
export function noteFocus(sessions, payload) {
  const session = sessionFor(sessions, {url: String(payload?.url || ''), title: String(payload?.title || ''), job: String(payload?.job || '')}, Number(payload?.tab));
  if (!session) return {ok: false};
  const found = !!payload?.found;
  focusAnswers.set(session.id, found);
  for (const done of focusWaiters.get(session.id) || []) done(found);
  focusWaiters.delete(session.id);
  return {ok: true, id: session.id};
}
// Whether the page found the field. null when it never said (the panel came forward, the field check did not).
export function focusFound(id, ms = 3000) {
  if (focusAnswers.has(id)) return Promise.resolve(focusAnswers.get(id));
  return new Promise(resolve => {
    const timer = setTimeout(() => { focusWaiters.set(id, (focusWaiters.get(id) || []).filter(fn => fn !== done)); resolve(null); }, ms);
    const done = found => { clearTimeout(timer); resolve(found); };
    focusWaiters.set(id, [...(focusWaiters.get(id) || []), done]);
  });
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

// Which Chrome tab is each session's form: the newest tab that reports for it (tab ids only grow within a browser run),
// so an older tab left from an earlier session of the same job neither answers for it nor hides that its form was closed.
const bound = new Map();  // session id → tab id
let openIds = null, bootId = '';
export function noteTabs({ids, boot} = {}) {
  if (boot && boot !== bootId) { bootId = String(boot); bound.clear(); }  // Chrome restarted: its tabs were numbered again
  openIds = Array.isArray(ids) ? new Set(ids.map(Number).filter(Number.isInteger)) : null;
}
// true / false: the session's tab is open / was closed. null: not known (no tab id seen yet, or no report).
export const tabOpen = id => (!bound.has(id) || !openIds ? null : openIds.has(bound.get(id)));
// The page's report. Returns what the page needs back: the session it matched, what to track, what to show.
export function report(sessions, payload, now = Date.now()) {
  const page = {url: String(payload?.url || ''), title: String(payload?.title || ''), job: String(payload?.job || '')};
  const tab = Number(payload?.tab);
  const session = sessionFor(sessions, page, tab);
  if (!session) return {matched: null, session: null, watch: [], commands: []};
  if (Number.isInteger(tab)) {
    const current = bound.get(session.id);
    if (current !== undefined && tab < current) return {matched: null, session: null, watch: [], commands: []};  // an older tab: not this session's form
    bound.set(session.id, tab);
  }
  // The session's tab, and when it first reported (Chrome gives no tab's creation time; its first report comes as its page
  // loads): a different tab starts the clock again, a restarted app does not (owner, 8 Oct 2026: show each session's tab).
  const before = last.get(session.id);
  const tabId = Number.isInteger(tab) ? tab : before?.tab ?? null;
  const tabAt = before?.tabAt && before.tab === tabId ? before.tabAt : now;
  const states = {};
  for (const item of Array.isArray(payload.watch) ? payload.watch : []) if (typeof item?.filled === 'boolean') states[String(item.id)] = item.filled;
  const state = {id: session.id, url: page.url.split(/[?#]/)[0].slice(0, 300), tab: tabId, tabAt, left: Math.max(0, Number(payload.left) || 0), total: Math.max(0, Number(payload.total) || 0), states,
    missing: (Array.isArray(payload.missing) ? payload.missing : []).slice(0, 30).map(label => String(label).slice(0, 120)).filter(Boolean)};
  // What's left as the ring counts it (an older extension sends only the required ones, as missing).
  if (Array.isArray(payload.pending)) state.pending = payload.pending.slice(0, 30).map(label => String(label).slice(0, 120)).filter(Boolean);
  state.ready = state.total > 0 && state.left === 0;
  if (payload.account) state.account = true;   // a sign-in or sign-up page: the session shows no CV card
  // Each field ticked off with the time it was first seen filled: the Applying page's "In the form" list.
  // Fields already filled when the app first hears of the form have no time (it didn't see them being filled); a field
  // filled after a fill is over was filled by you. A restarted app keeps what it had (persist).
  const seen = new Map((before?.filled || []).map(item => [item.label, item]));
  if (Array.isArray(payload.filled)) state.filled = payload.filled.slice(0, 40).map(label => String(label).slice(0, 120)).filter(Boolean)
    .map(label => seen.get(label) || {label, at: before?.filled ? now : null, by: before?.filled && payload.over && !payload.busy ? 'you' : 'fill'});
  if (JSON.stringify(last.get(session.id)) !== JSON.stringify(state)) { last.set(session.id, state); save(); reporter({...state, at: now}); }
  const due = (commands.get(session.id) || []).filter(c => now - c.at < COMMAND_SECONDS * 1000);
  commands.delete(session.id);
  if (due.length) { for (const done of waiting.get(session.id) || []) done(); waiting.delete(session.id); }
  // The panel's header: which job this is and what Claude is doing on it (no answers, no personal data).
  const about = {id: session.id, url: session.url, title: session.title || '', company: session.company || '', status: session.status,
    note: session.note || '', live: session.live ?? !session.endedAt};
  return {matched: session.id, session: about, watch: watches.get(session.id) || [],
    commands: due.map(({focus, close, reload}) => (close ? {close: true} : reload ? {reload: true} : {focus}))};
}
// The form's tab is gone and the page can't report (the extension can't reach the app): its cached "18 of 18, ready"
// describes a form that no longer exists. Forget it, here and on disk.
export function forget(id) { last.delete(id); bound.delete(id); save(); }
// Every form's last state, for a window that just loaded (⌘R) and missed them: they're passed on only when they change.
export const allStates = () => [...last.values()];
export const _reset = () => { keptFile = ''; watches.clear(); commands.clear(); bound.clear(); openIds = null; bootId = ''; last.clear(); waiting.clear(); focusAnswers.clear(); focusWaiters.clear(); reporter = () => {}; };  // tests

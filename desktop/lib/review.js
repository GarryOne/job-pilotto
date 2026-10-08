// The form page and the session page, in step. The Chrome extension shows a ring on the application form (how much
// is left before you can submit) and reports it here; the session page shows the same, ticks off the agreements you
// tick in the form, and its "Open the form to tick it" makes the page scroll to that field.
//   page -> app  POST /extension/review {url, title, left, total, missing: [label], filled: [label], watch: [{id, filled: true|false|null}]}
//   app -> page  the reply: {matched, watch: [{id, label}], commands: [{focus: label}]}
import fs from 'node:fs';
import {ATS, scoreTab} from './form-tab.js';
import {LABELS} from './contact.js';
const CONTACT_KEYS = Object.keys(LABELS);

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
    for (const state of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      if (!state?.id || (sessionIds && !sessionIds.includes(state.id))) continue;
      last.set(state.id, state);
      // Its tab, as the last report saw it: a restarted app knows it at once, and the next tab report says open or closed (owner, 8 Oct 2026:
      // after a restart the open Coop form showed "Form closed", the app had only the address to go by).
      if (Number.isInteger(state.tab)) { bound.set(state.id, state.tab); runOf.set(state.id, String(state.boot || '')); }
    }
  } catch {}
}
function save() {
  if (!keptFile) return;
  try { fs.writeFileSync(keptFile, JSON.stringify([...last.values()]), {mode: 0o600}); } catch {}
}
export const setReporter = fn => { reporter = fn; };
const stateListeners = [];   // more readers of each new form state (lib/menu-rearm.js), beside the window's reporter
export const onState = fn => { stateListeners.push(fn); };

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
export function sessionFor(sessions, page, tab) { return pick(sessions, page, tab).session; }
// The session a page belongs to, and how that was decided: 'session' (the tab carries its session id: the extension stores the
// app's answer on the tab and passes it to the next pages and the tabs it opens), 'job' / 'score' (matchSession), 'guess'.
// A tab carrying its session is never matched to another (8 Oct 2026: Migros's sign-in tab, carrying nothing, was guessed to
// be Manor's, the one session no tab was bound to, and Manor's card showed Migros's form).
function pick(sessions, page, tab) {
  const carried = page.session ? sessions.find(session => session.id === page.session) : null;
  if (carried) return {session: carried, by: 'session'};
  const found = guess(sessions, page, tab);
  // It carries a session that is gone (cancelled, started again under a new id): its job may find the new one, a guess never.
  if (page.session && found.by === 'guess') return {session: null, by: 'gone'};
  return found;
}
function guess(sessions, page, tab) {
  const scored = matchSession(sessions, page);
  if (scored) return {session: scored, by: page.job && jobKey(page.job) === jobKey(scored.url) ? 'job' : 'score'};
  return {session: freeSession(sessions, page, tab), by: 'guess'};
}
function freeSession(sessions, page, tab) {
  if (!String(page.url || '').includes('jobpilotto-fill')) return null;
  // A form on a known job board is some other job's (it would have matched by its job ID or company): left alone, or a stray
  // tab of a finished application (1 Oct 2026: a Scale AI form) lands on this card.
  const host = hostOf(page.url);
  if (!host || ATS.test(host)) return null;
  const free = sessions.filter(session => ['running', 'input'].includes(session.status)
    && (!bound.has(session.id) || !sameRun(session.id) || (Number.isInteger(tab) && bound.get(session.id) === tab)));
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
// "Use" on the session page: the form's own panel fills that field through the extension's fill (extension/page/propose.js).
export function queueFill(id, label, value, now = Date.now()) {
  commands.set(id, [...(commands.get(id) || []).filter(c => now - c.at < COMMAND_SECONDS * 1000), {fill: {label: String(label).slice(0, 120), value: String(value).slice(0, 200)}, at: now}]);
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
// A tab id means something only in its browser run (Chrome numbers tabs again when it starts), so each binding keeps its run's id
// (the extension's `boot`, which changes only when Chrome starts: extension/tab-memory.js). A binding from an earlier run is a closed tab.
const bound = new Map();  // session id → tab id
const runOf = new Map();  // session id → the browser run its tab id belongs to ('' unknown: saved by an older app)
// Each browser's open tabs (`browser`: one Chrome profile, kept across its restarts; an older extension: its run `boot`), from its own
// reports: two browsers with the extension (a second profile, a test Chrome paired by mistake) each say what THEY have open, and one never
// closes the other's forms. A browser that restarts replaces its entry (a new run: the old tab ids mean nothing); one silent for RUN_MS is gone.
// 8 Oct 2026: a test browser with no tabs reported every few seconds, and the owner's open Coop form flipped to "Form closed".
export const RUN_MS = 90 * 1000;
const runs = new Map();   // browser (else boot) → {boot, ids: Set | null, at}
let bootId = '', clock = () => Date.now();
const liveRuns = () => { const now = clock(); for (const [key, run] of runs) if (now - run.at > RUN_MS) runs.delete(key); return [...runs.values()]; };
const sameRun = (id, boot = bootId) => !runOf.get(id) || !boot || runOf.get(id) === boot;
function bind(id, tab, boot, by, host = '', keep = true) {
  if (bound.get(id) === tab && runOf.get(id) === boot) return;
  bindLog({id, tab, before: bound.get(id) ?? null, by, host, ...(runOf.has(id) && runOf.get(id) !== boot ? {newRun: true} : {})});
  bound.set(id, tab); runOf.set(id, boot);
  const state = keep && last.get(id);   // a page's report saves its own state; a tab report keeps the new tab here
  if (state && (state.tab !== tab || state.boot !== boot)) { last.set(id, {...state, tab, boot, tabAt: state.tab === tab ? state.tabAt : Date.now()}); save(); }
}
// The extension's tab report (every 30 s): which tabs exist in which run, and the session each tab carries (`sessions`: tab id → session id).
// A tab carrying a session is that session's tab, unless the session already follows a newer one.
export function noteTabs({ids, boot, browser, sessions} = {}, known = null) {
  const run = String(boot || '');
  if (run) bootId = run;
  const openIds = Array.isArray(ids) ? new Set(ids.map(Number).filter(Number.isInteger)) : null;
  runs.set(String(browser || run), {boot: run, ids: openIds, at: clock()});
  for (const [tab, id] of Object.entries(sessions && typeof sessions === 'object' ? sessions : {})) {
    const tabId = Number(tab);
    if (!Number.isInteger(tabId) || !id || (known && !known.has(String(id))) || !openIds?.has(tabId)) continue;
    if (bound.has(String(id)) && sameRun(String(id), run) && bound.get(String(id)) > tabId) continue;   // it follows a newer tab
    bind(String(id), tabId, run, 'tab report');
  }
}
// true / false: the session's tab is open / was closed. null: not known (no tab id seen yet, or no report).
// Asked of the run the session's tab belongs to; a session from before runs were known asks every live run. No live run: not known.
export const tabOpen = id => {
  const live = liveRuns();
  if (!bound.has(id) || !live.length) return null;
  const tab = bound.get(id), own = runOf.get(id);
  const asked = own ? live.filter(run => run.boot === own) : live;
  if (asked.some(run => !run.ids)) return null;   // a report without tab ids says nothing
  return asked.some(run => run.ids.has(tab));
};
// Open, closed or not known, per session: its own tab decides when the app knows it; otherwise the address only ever says open
// (a form on another site than the posting matches no address, and was shown closed while it was open: owner, 8 Oct 2026).
export function formStates(ids, byLook = new Set()) {
  const open = [], unsure = [];
  for (const id of ids) {
    const own = tabOpen(id);
    if (own === true || (own === null && byLook.has(id))) open.push(id);
    else if (own === null) unsure.push(id);
  }
  return {ids: open, unsure};
}
// The page's report. Returns what the page needs back: the session it matched, what to track, what to show.
// Is `tab` older than the tab the session follows now? Its reports (progress, "no form") describe a page the session left.
export const olderTab = (id, tab, boot = bootId) => Number.isInteger(Number(tab)) && bound.has(id) && (!boot || !runOf.get(id) || runOf.get(id) === String(boot)) && Number(tab) < bound.get(id);
let bindLog = () => {};
// Told each time a session takes a tab as its own: which, the one before, and how it was decided (see pick).
export function onBind(fn) { bindLog = fn; }
const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };
export function report(sessions, payload, now = Date.now()) {
  const page = {url: String(payload?.url || ''), title: String(payload?.title || ''), job: String(payload?.job || ''), session: String(payload?.session || '')};
  const tab = Number(payload?.tab), boot = String(payload?.boot || bootId || '');   // the run that tab id belongs to
  const {session, by} = pick(sessions, page, tab);
  if (!session) return {matched: null, session: null, watch: [], commands: []};
  if (Number.isInteger(tab)) {
    // A session follows its newest tab (tab ids only grow within a browser run): an older tab of it goes quiet and is told so.
    if (olderTab(session.id, tab, boot)) return {matched: null, moved: true, session: null, watch: [], commands: []};
    bind(session.id, tab, boot, by, hostOf(page.url), false);
  }
  // The session's tab, and when it first reported (Chrome gives no tab's creation time; its first report comes as its page
  // loads): a different tab starts the clock again, a restarted app does not (owner, 8 Oct 2026: show each session's tab).
  const before = last.get(session.id);
  const tabId = Number.isInteger(tab) ? tab : before?.tab ?? null;
  const tabAt = before?.tabAt && before.tab === tabId ? before.tabAt : now;
  const states = {};
  for (const item of Array.isArray(payload.watch) ? payload.watch : []) if (typeof item?.filled === 'boolean') states[String(item.id)] = item.filled;
  const state = {id: session.id, url: page.url.split(/[?#]/)[0].slice(0, 300), tab: tabId, boot: Number.isInteger(tab) ? boot : before?.boot || '', tabAt, left: Math.max(0, Number(payload.left) || 0), total: Math.max(0, Number(payload.total) || 0), states,
    missing: (Array.isArray(payload.missing) ? payload.missing : []).slice(0, 30).map(label => String(label).slice(0, 120)).filter(Boolean)};
  // What's left as the ring counts it (an older extension sends only the required ones, as missing).
  if (Array.isArray(payload.pending)) state.pending = payload.pending.slice(0, 30).map(label => String(label).slice(0, 120)).filter(Boolean);
  // The questions the AI read as knockouts, in any language (extension/page/categories.js): the session card lists them before you submit.
  if (Array.isArray(payload.knockouts)) state.knockouts = payload.knockouts.slice(0, 30).map(label => String(label).slice(0, 120)).filter(Boolean);
  // What the fill proposed for a field it left (a value), or the contact detail it asks for (a key): the session page's rows offer it.
  if (Array.isArray(payload.proposals)) state.proposals = payload.proposals.slice(0, 30).map(item => ({label: String(item?.label || '').slice(0, 120),
    value: String(item?.value || '').slice(0, 200), key: CONTACT_KEYS.includes(item?.key) ? item.key : '',
    options: (Array.isArray(item?.options) ? item.options : []).slice(0, 60).map(option => String(option).slice(0, 80)).filter(Boolean)}))
    .filter(item => item.label && (item.value || item.key));
  // A sign-in or sign-up page (the extension's page rule, or the panel saw a password box): its fields are the account's, never the
  // application's progress: no "ready to submit", no Form completion, no empty-field rows (the session page reads `account`).
  if (payload.role ? payload.role === 'account' : payload.account) state.account = true;   // the rule's word wins: a combined page (CV + password) is the form
  state.ready = !state.account && state.total > 0 && state.left === 0;
  // Each field ticked off with the time it was first seen filled: the Applying page's "In the form" list.
  // Fields already filled when the app first hears of the form have no time (it didn't see them being filled); a field
  // filled after a fill is over was filled by you. A restarted app keeps what it had (persist).
  const seen = new Map((before?.filled || []).map(item => [item.label, item]));
  if (Array.isArray(payload.filled)) state.filled = payload.filled.slice(0, 40).map(label => String(label).slice(0, 120)).filter(Boolean)
    .map(label => seen.get(label) || {label, at: before?.filled ? now : null, by: before?.filled && payload.over && !payload.busy ? 'you' : 'fill'});
  if (JSON.stringify(last.get(session.id)) !== JSON.stringify(state)) { last.set(session.id, state); save(); reporter({...state, at: now}); for (const fn of stateListeners) { try { fn(state); } catch {} } }
  const due = (commands.get(session.id) || []).filter(c => now - c.at < COMMAND_SECONDS * 1000);
  commands.delete(session.id);
  if (due.length) { for (const done of waiting.get(session.id) || []) done(); waiting.delete(session.id); }
  // The panel's header: which job this is and what Claude is doing on it (no answers, no personal data).
  const about = {id: session.id, url: session.url, title: session.title || '', company: session.company || '', status: session.status,
    note: session.note || '', live: session.live ?? !session.endedAt};
  return {matched: session.id, session: about, watch: watches.get(session.id) || [],
    commands: due.map(({focus, close, reload, fill}) => (close ? {close: true} : reload ? {reload: true} : fill ? {fill} : {focus}))};
}
// The form's tab is gone and the page can't report (the extension can't reach the app): its cached "18 of 18, ready"
// describes a form that no longer exists. Forget it, here and on disk.
export function forget(id) { last.delete(id); bound.delete(id); runOf.delete(id); save(); }
// Every form's last state, for a window that just loaded (⌘R) and missed them: they're passed on only when they change.
export const allStates = () => [...last.values()];
export const _clock = fn => { clock = fn; };   // tests
export const _reset = () => { keptFile = ''; watches.clear(); commands.clear(); bound.clear(); runOf.clear(); runs.clear(); bootId = ''; clock = () => Date.now(); last.clear(); waiting.clear(); focusAnswers.clear(); focusWaiters.clear(); reporter = () => {}; bindLog = () => {}; };  // tests

// The background worker: tabs the app opens to fill (#jobpilotto-fill), Apply with Claude's hand-off, the ring's
// messages to the app, and the connection check. The result of a fill shows in a panel on the page and in the icon badge.
import {JOB_SITES, NOT_CONNECTED, NO_APP, api, fillTab, forgetAI, pair, settings} from './flow.js';
import {ensureAlarm} from './report-alarm.js';
import {confirmationOf, missedConfirmation, pageFingerprint, pageKey, sameSite, submissionOutcome, SUBMIT_WAIT_MS, tabArmed} from './tab-pages.js';

// The tab we may touch: Chrome reuses a tab id after its tab closes, and the user can navigate the tab elsewhere
// while a fill is still running, so every injection asks the tab what it shows first (tab-pages.js).
async function onPage(tabId, url) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return sameSite(tab?.url, url) ? tab : null;
}

// ---- What the extension decided, and why ----
// A service worker's console dies with it, and a decision it made (marking a job Applied, or refusing to) used to
// leave no trace anywhere — which is why 1 Oct 2026's wrong "Applied" could not be explained. Every decision is kept
// in a small ring buffer in chrome.storage.local and pushed to the app, whose log holds it (`grep extension
// logs/app.log`); entries the push could not deliver stay unsent and go with the next one, so a crashed worker's
// last decisions still arrive. Ids, hosts, reasons and counts only — never a form answer or a page's text.
const LOG_KEY = 'jp-decisions';
const LOG_KEEP = 50;
async function decisions() {
  const {[LOG_KEY]: kept = []} = await chrome.storage.local.get(LOG_KEY).catch(() => ({}));
  return Array.isArray(kept) ? kept : [];
}
async function decide(kind, text, fields = {}) {
  const entry = {at: new Date().toISOString(), kind: String(kind).slice(0, 24), text: String(text).slice(0, 300),
    fields: {...fields, version: chrome.runtime.getManifest().version}, sent: false};
  await chrome.storage.local.set({[LOG_KEY]: [...await decisions(), entry].slice(-LOG_KEEP)}).catch(() => {});
  pushDecisions();
  return entry;
}
async function pushDecisions() {
  const kept = await decisions();
  const unsent = kept.filter(entry => !entry.sent);
  if (!unsent.length) return;
  try {
    const config = await settings();
    const response = await fetch(`${config.workerUrl.replace(/\/$/, '')}/extension/log`, {method: 'POST',
      headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({entries: unsent.slice(-20)})});
    if (!response.ok) return;
    const sent = new Set(unsent.map(entry => entry.at + entry.text));
    await chrome.storage.local.set({[LOG_KEY]: (await decisions())
      .map(entry => (sent.has(entry.at + entry.text) ? {...entry, sent: true} : entry))});
  } catch { /* not paired, or the app is closed: they stay unsent for the next push */ }
}
pushDecisions();  // a worker that just started delivers whatever the last one could not

async function note(tabId, text, url = '') {
  if (url && !(await onPage(tabId, url))) return;  // the tab is showing something else now: leave it alone
  await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', args: [text], func: message => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:320px;background:#132439;color:#fff;' +
      'border-radius:10px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px #0008';
    box.textContent = message;
    box.onclick = () => box.remove();
    document.documentElement.append(box);
  }}).catch(() => {});
}

// "Apply to N jobs" in the desktop app opens each job with #jobpilotto-fill. That mark is the only way a tab
// becomes one the extension may touch: the panel, the fill and the submit listener never start on a page
// the user opened themselves.
export const FILL_MARK = 'jobpilotto-fill';
const started = new Set();
const armedLogged = new Set();
const panelRefused = new Set();
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url?.includes(`#${FILL_MARK}`)) return;
  if (info.status !== 'loading' && info.status !== 'complete') return;
  let origin = '';
  try { origin = new URL(tab.url).origin + '/*'; } catch { return; }
  if (!(await chrome.permissions.contains({origins: [origin]}))) {
    if (info.status !== 'complete') return;
    // Not one of the supported job sites, and "Work on every job site" is off. The app opened this tab;
    // the extension still does not run here until that permission is granted.
    chrome.action.setBadgeText({tabId, text: '?'}).catch(() => {});  // the tab may already be closed
    chrome.action.setTitle({tabId, title: 'Job Pilotto: this site needs Settings → Work on every job site'}).catch(() => {});  // the tab may already be closed
    return;
  }
  chrome.storage.session.set({[`from:${tabId}`]: tab.url.replace(`#${FILL_MARK}`, '')});
  await arm(tabId, 'fill mark');  // while the document loads, so Apply with Claude finds the hook
  if (info.status !== 'complete' || started.has(tabId)) return;
  started.add(tabId);
  await fillOpenedTab(tab, tab.url.replace(`#${FILL_MARK}`, ''));
});

// The panel is injected only into a tab the desktop app opened. A new document in that same tab (the form's
// next step) gets the scripts again. Nothing is injected into a tab the user opened themselves.
async function arm(tabId, why = 'app tab') {
  await chrome.storage.session.set({[`armed:${tabId}`]: true});
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  let host = '';
  try { host = new URL(tab?.url || '').hostname; } catch { /* not a url */ }
  const mark = `${tabId}:${host}`;
  if (host && !armedLogged.has(mark)) {
    armedLogged.add(mark);
    decide('panel', 'panel on a tab the app opened', {host, why});
  }
  await chrome.scripting.executeScript({target: {tabId, allFrames: true}, files: ['hook.js', 'review.js'], injectImmediately: true}).catch(() => {});
}
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !/^https:/.test(tab.url || '') || tab.url.includes(`#${FILL_MARK}`)) return;
  const key = `armed:${tabId}`;
  if (!(await chrome.storage.session.get(key))[key]) return;
  await arm(tabId, 'next page');
});

// A progress panel on the page while a tab fills itself (the popup is closed then). `url`: the page being filled —
// nothing is drawn when that tab has moved on to another site (or its id came back as a different tab).
async function progress(tabId, text, url = '') {
  if (url && !(await onPage(tabId, url))) return;
  // The page's panel (review.js) shows it when it is there; the floating box is for pages without one. Whichever
  // takes it, the other is cleared: a box drawn before the panel opened used to stay on the page for good, above a
  // form that was already "Ready to submit" (1 Oct 2026).
  const shown = await chrome.tabs.sendMessage(tabId, {type: 'panelStep', text}).catch(() => null);
  await stepBox(tabId, shown?.shown ? '' : text);
}

// The floating step box: drawn, updated, or (with no text) removed. Only for pages whose panel can't show the step.
function stepBox(tabId, message) {
  return chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', args: [message], func: message => {
    let box = document.getElementById('jobpilotto-progress');
    if (!message) { box?.remove(); return; }
    if (!box) {
      box = Object.assign(document.createElement('div'), {id: 'jobpilotto-progress'});
      box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:320px;background:#132439;color:#fff;' +
        'border-radius:10px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px #0008;display:flex;gap:10px';
      const spin = document.createElement('span');
      spin.style.cssText = 'flex:none;width:14px;height:14px;margin-top:2px;border-radius:50%;border:2px solid #3b5170;border-top-color:#f07014';
      spin.animate([{transform: 'rotate(0)'}, {transform: 'rotate(360deg)'}], {duration: 800, iterations: Infinity});
      box.append(spin, document.createElement('span'));
      document.documentElement.append(box);
    }
    box.lastChild.textContent = `Job Pilotto: ${message}`;
  }}).catch(() => {});
}

// "Didn't fill: <reason>" with a Fill anyway button on the page itself.
async function ineligibleNote(tabId, reason) {
  await chrome.scripting.executeScript({target: {tabId}, args: [reason], func: text => {
    document.getElementById('jobpilotto-note')?.remove();
    const box = Object.assign(document.createElement('div'), {id: 'jobpilotto-note'});
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:340px;background:#132439;color:#fff;' +
      'border-radius:10px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px #0008';
    const message = Object.assign(document.createElement('div'), {textContent: `Job Pilotto didn't fill this form: ${text}`});
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:10px';
    const button = (label, primary) => {
      const b = Object.assign(document.createElement('button'), {textContent: label, type: 'button'});
      b.style.cssText = `padding:6px 12px;border-radius:7px;border:${primary ? '0' : '1px solid #3b5170'};background:${primary ? '#d9540b' : 'transparent'};` +
        'color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer';
      return b;
    };
    const anyway = button('Fill anyway', true), close = button('Close', false);
    anyway.onclick = () => { box.remove(); chrome.runtime.sendMessage({type: 'fillAnyway'}); };
    close.onclick = () => box.remove();
    row.append(anyway, close);
    box.append(message, row);
    document.documentElement.append(box);
  }}).catch(() => {});
}

// Returns what was done ({filled, todo, ineligible, note}) or {error}, for Apply with Claude's hand-off.
// The kit and your contact details + CV per job, fetched when the panel first sees the form, so Fill starts at once.
// Kept 10 minutes (an edited kit or profile shows up after that, or at the next page load).
const early = new Map();  // job url -> {at, kit: Promise, me: Promise}
const FRESH_MS = 10 * 60 * 1000;
function prefetch(config, url) {
  const known = early.get(url);
  if (known && Date.now() - known.at < FRESH_MS) return known;
  const entry = {at: Date.now(),
    kit: api(config, `/extension/kit?url=${encodeURIComponent(url)}`),
    me: api(config, `/extension/me?url=${encodeURIComponent(url)}`)};
  entry.kit.catch(() => early.delete(url));
  entry.me.catch(() => early.delete(url));
  // Details that came with an error (Notion failed) aren't kept: the next Fill asks the app again.
  entry.me.then(me => { if (me?.contactError) early.delete(url); }, () => {});
  early.set(url, entry);
  return entry;
}

// fast: the page is already there (the panel's Fill): no wait for it to render.
async function fillOpenedTab(tab, url, force = false, {fast = false} = {}) {
  await arm(tab.id);
  if (!fast) await new Promise(resolve => setTimeout(resolve, 1500)); // forms render after the load event
  const page = tab.url || url;  // the page this fill belongs to: progress is only ever drawn while the tab shows it
  chrome.action.setBadgeText({tabId: tab.id, text: '…'}).catch(() => {});  // the tab may already be closed
  try {
    const config = await settings();
    const ready = prefetch(config, url);
    // No kit (404: not tracked) fills without one; no app or no connection stops with the reason.
    const kit = await ready.kit.catch(error => {
      if (error.status === 401) throw error;
      if (!error.status) throw new Error(NO_APP);
      return {};
    });
    const me = await ready.me.catch(() => null);  // missing: fillTab fetches it and says what's wrong
    const result = await fillTab(tab, config, {jobUrl: url, kitAnswers: kit.kit?.answers || [], coverLetter: kit.kit?.cover_letter || '', force, me,
      onStep: text => progress(tab.id, text, page)});
    // The kit's eligibility verdict, as a reminder (applying anyway was the user's choice).
    if (kit.kit?.eligible === false) await note(tab.id, `⛔ Reminder from your kit: ${kit.kit.eligibility_note}`, page);
    await progress(tab.id, '', page);
    if (result.ineligible && await onPage(tab.id, page)) await ineligibleNote(tab.id, result.note);
    decide('fill', result.ineligible ? `did not fill: ${result.note || 'ineligible'}` : 'filled the form',
      {url: page, ineligible: !!result.ineligible});
    chrome.action.setBadgeText({tabId: tab.id, text: result.ineligible ? '!' : '✓'}).catch(() => {});  // the tab may already be closed
    return result;
  } catch (error) {
    await progress(tab.id, '', page);
    decide('fill', `failed: ${error.message}`, {url: page});
    await note(tab.id, `✈️ Job Pilotto couldn't fill this page: ${error.message}. If the form is behind an "Apply" button, open that form from the Job Pilotto app.`, page);
    chrome.action.setBadgeText({tabId: tab.id, text: '!'}).catch(() => {});  // the tab may already be closed
    return {error: error.message};
  }
}

// Apply with Claude asked for a fill on this tab (hook.js): check its ticket with the app, fill, and write the
// result on the page for the session to read. It then fills what's left, checks, and stops before Submit.
async function handOff(tab, job, ticket) {
  await arm(tab.id);
  const state = value => chrome.scripting.executeScript({target: {tabId: tab.id}, args: [JSON.stringify(value)],
    func: text => { document.documentElement.dataset.jobpilottoFill = text; }}).catch(() => {});
  try {
    const config = await settings();
    const checked = await api(config, '/extension/ticket', {method: 'POST', body: JSON.stringify({ticket, job})});
    if (!checked.ok) throw new Error('ticket not accepted');
  } catch (error) {
    await state({state: 'error', error: `not allowed: ${error.message}`});
    return;
  }
  await state({state: 'running'});
  started.add(tab.id);
  const result = await fillOpenedTab(tab, job.split('#')[0], true);
  await state(result?.error ? {state: 'error', error: result.error}
    : {state: 'done', filled: result?.filled || 0, left: (result?.todo || []).length, todo: (result?.todo || []).slice(0, 20)});
}

// Older builds registered the panel on every https page ("Work on every job site"). Take that registration
// down: a page is touched only when the desktop app opened its tab.
async function retireEverywhere() {
  await chrome.scripting.unregisterContentScripts({ids: ['hook-everywhere']}).catch(() => {});
}
chrome.runtime.onInstalled.addListener(retireEverywhere);
chrome.runtime.onStartup.addListener(retireEverywhere);
retireEverywhere();

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // The page's panel saw a submit press (review.js): the evidence that a submission happened in that tab.
  if (message?.type === 'panelAllowed' && sender.tab) {
    const key = `armed:${sender.tab.id}`;
    chrome.storage.session.get(key).then(stored => {
      const ok = tabArmed({url: sender.tab.url, armed: stored[key]});
      if (!ok) {
        let host = '';
        try { host = new URL(sender.tab.url).hostname; } catch { /* not a url */ }
        if (!panelRefused.has(host)) {
          panelRefused.add(host);
          decide('panel', 'page was not opened by the app: panel not shown', {host});
        }
      }
      reply({ok});
    }, () => reply({ok: false}));
    return true;
  }
  if (message?.type === 'submitted' && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    const url = pageKey(message.url || sender.tab.url || '');
    const at = Date.now();
    const fingerprint = pageFingerprint(message.snapshot || {});
    const where = submissionOutcome({at, from: url, to: url, before: fingerprint, after: fingerprint});
    chrome.storage.session.set({[`submit:${tabId}`]: {at, url, fingerprint, calls: 0}}).then(() => watchSubmission(tabId)).catch(() => {});
    decide('submitted', 'submit pressed', {host: where.host, path: where.path});
    reply({ok: true});
    return false;
  }
  if (message?.type === 'fillAnyway' && sender.tab) {
    fillOpenedTab(sender.tab, sender.tab.url.replace(`#${FILL_MARK}`, ''), true);
    reply({ok: true});
    return false;
  }
  if (message?.type === 'claudeFill' && sender.tab) {
    handOff(sender.tab, String(message.job || ''), String(message.ticket || ''));
    reply({ok: true});
    return false;
  }
  // The panel (review.js). App first: its job, its session and the state of the form, shared both ways. Without the
  // app (not open, or your own Worker) the panel still shows the form's progress and fills through your Worker.
  if (message?.type === 'panelJob' && sender.tab) {
    (async () => {
      const config = await settings();
      const app = !config.workerUrl || config.workerUrl.startsWith('http://127.0.0.1');
      try {
        const data = await prefetch(config, String(message.url || sender.tab.url).split('#')[0]).kit;  // the contact details come along
        return {connected: true, app, job: data.job || null, answers: data.kit?.answers?.length || 0, coverLetter: data.kit?.cover_letter || ''};
      } catch (error) {
        // The app answered (an error is still an answer): connected, and say what failed; only no answer is "not connected".
        return {connected: !!error.status, app, job: null, answers: 0, coverLetter: '', retry: !!error.status && error.status !== 404,
          why: !error.status ? (app ? NO_APP : error.message) : error.status === 404 ? '' : `Connected, but this job couldn't be loaded (${error.message || error.status}): trying again`};
      }
    })().then(reply, () => reply({connected: false}));
    return true;
  }
  if (message?.type === 'panelFill' && sender.tab) {
    const url = String(message.url || sender.tab.url).split('#')[0];
    started.add(sender.tab.id);
    forgetAI(sender.tab).then(() => fillOpenedTab(sender.tab, url, !!message.force, {fast: true})).then(result => reply({
      ok: !result?.error, error: result?.error || '', ineligible: !!result?.ineligible, note: result?.note || '',
      filled: result?.filled || 0, todo: (result?.todo || []).slice(0, 20), coverLetter: result?.coverLetter || ''}));
    return true;
  }
  if (message?.type === 'panelApplied' && sender.tab) {
    settings().then(config => api(config, '/extension/applied', {method: 'POST', body: JSON.stringify({url: message.url || sender.tab.url})}))
      .then(data => reply({ok: true, message: data.message || 'Marked Applied'}), error => reply({ok: false, error: error.message}));
    return true;
  }
  // The app asked to see this form: its tab and window come forward (the extension knows the tab; no Mac scripting).
  if (message?.type === 'panelShowTab' && sender.tab) {
    chrome.tabs.update(sender.tab.id, {active: true})
      .then(() => chrome.windows.update(sender.tab.windowId, {focused: true}))
      .then(() => reply({ok: true}), () => reply({ok: false}));
    return true;
  }
  // The application was cancelled in the app: this form's tab closes.
  if (message?.type === 'panelCloseTab' && sender.tab) {
    chrome.tabs.remove(sender.tab.id).then(() => reply({ok: true}), () => reply({ok: false}));
    return true;
  }
  if (message?.type === 'panelOpenApp') {
    settings().then(config => api(config, '/extension/open', {method: 'POST', body: JSON.stringify({session: message.session})}))
      .then(data => reply({ok: !!data.ok}), () => reply({ok: false}));
    return true;
  }
  // The form page's ring (review.js): what's left there, to the app's session page; back: what to watch and show.
  if (message?.type === 'review' && sender.tab) {
    (async () => {
      const config = await settings();
      if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {matched: null};  // your own Worker: no app
      return api(config, '/extension/review', {method: 'POST', body: JSON.stringify(message.payload || {})});
    })().then(reply, () => reply({matched: null}));
    return true;  // the reply comes later
  }
  return false;
});

// Just loaded: open the settings page, which connects to the Job Pilotto Mac app by itself.
chrome.runtime.onInstalled.addListener(({reason}) => { if (reason === 'install') chrome.runtime.openOptionsPage(); });

// After a reload: put the panel back on tabs the app opened, and take it off every other page (Calendly, a job
// site you were reading). The old script's listeners die with the reload; the pill they drew does not.
async function settleOpenTabs() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const tab of tabs) {
    if (tab.id == null || !/^https:/.test(tab.url || '')) continue;
    const key = `armed:${tab.id}`;
    const armed = tabArmed({url: tab.url, armed: (await chrome.storage.session.get(key).catch(() => ({})))[key]});
    if (armed) { await arm(tab.id, 'still open'); continue; }
    const frames = await chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, func: () => {
      let removed = 0;
      for (const id of ['jobpilotto-review-host', 'jobpilotto-progress', 'jobpilotto-note']) {
        const node = document.getElementById(id);
        if (node) { node.remove(); removed++; }
      }
      return removed;
    }}).catch(() => []);
    const removed = frames.reduce((n, frame) => n + (frame.result || 0), 0);
    if (!removed) continue;
    let host = '';
    try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
    decide('panel', 'removed a panel from a page the app did not open', {host, removed});
  }
}
chrome.runtime.onInstalled.addListener(settleOpenTabs);
chrome.runtime.onStartup.addListener(settleOpenTabs);

// Tell the Job Pilotto app which job pages are open, so its Jobs list shows "Opened in Chrome" only while they are.
async function reportTabs() {
  const config = await settings();
  if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;  // your own Worker: no app here
  const urls = (await chrome.tabs.query({url: JOB_SITES})).map(tab => tab.url);
  // Doubles as the connection check (reconnecting by itself, see api()): a red ! on the icon while it fails.
  try {
    const answer = await api(config, '/extension/tabs', {method: 'POST', body: JSON.stringify({urls, version: chrome.runtime.getManifest().version})});
    connected(true);
    // The app has a newer copy of this extension (its folder was updated): load it. Once per version, so a copy
    // that can't update (a store install) doesn't reload over and over.
    if (answer?.latest && newer(answer.latest, chrome.runtime.getManifest().version)) {
      const {reloadedFor} = await chrome.storage.local.get('reloadedFor');
      if (reloadedFor !== answer.latest) { await chrome.storage.local.set({reloadedFor: answer.latest}); chrome.runtime.reload(); }
    }
  } catch (error) {
    connected(false, error.status ? NOT_CONNECTED : NO_APP);
  }
}
export function newer(a, b) {
  const [x, y] = [a, b].map(v => String(v || '0').split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
function connected(ok, why = '') {
  chrome.action.setBadgeText({text: ok ? '' : '!'}).catch(() => {});
  chrome.action.setTitle({title: ok ? 'Job Pilotto' : `Job Pilotto: ${why}`}).catch(() => {});
}
// A closed tab's id comes back for another tab: forget everything kept for it, so no fill and no submitted-check is
// ever carried over to whatever opens next (tab-pages.js).
chrome.tabs.onRemoved.addListener(async tabId => {
  await chrome.storage.session.remove([`from:${tabId}`, `job:${tabId}`, `armed:${tabId}`, `submit:${tabId}`, `judged:${tabId}`]).catch(() => {});
  for (const mark of [...armedLogged]) if (mark.startsWith(`${tabId}:`)) armedLogged.delete(mark);
  // A closed tab's id is reused for the next tab. `started` holds that id as a number, so a string check never
  // matched it and the new tab was treated as already filled.
  for (const key of [...started]) {
    if (key === tabId || (typeof key === 'string' && key.startsWith(`${tabId} `))) started.delete(key);
  }
  reportTabs();
});
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url || info.status === 'complete') reportTabs(); });
chrome.runtime.onStartup.addListener(reportTabs);
// Also every 30 s, so an app started after the tabs were opened still learns about them. Only if it isn't there
// already: creating an alarm that exists resets it, and this worker wakes far more often than every 30 s.
ensureAlarm({get: name => chrome.alarms.get(name), create: (name, info) => chrome.alarms.create(name, info)});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'report-tabs') reportTabs(); });
reportTabs();

// Submitted? The submit press starts a short watch. A redirect or a change on the same page (a confirmation
// message where the form was) is then read by the app. The address alone is not a submission, and a press
// that leaves the page unchanged is not one either.
const loggedMiss = new Set();
const watching = new Map(); // tab id -> the submit press (its timestamp) this watch belongs to
const ASK_LIMIT = 2;
function logOnce(tabId, text, fields) {
  const key = `${tabId}:${text}:${fields.host || ''}/${fields.path || ''}/${fields.id || ''}`;
  if (loggedMiss.has(key)) return;
  loggedMiss.add(key);
  decide('submitted?', text, fields);
}
async function readLandedPage(tabId) {
  const [frame] = await chrome.scripting.executeScript({target: {tabId}, func: () => {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const headings = [...document.querySelectorAll('h1, h2')].map(el => clean(el.innerText)).filter(Boolean).slice(0, 6);
    const inputs = [...document.querySelectorAll('input, textarea, select')].filter(el => el.type !== 'hidden' && el.getClientRects().length).length;
    return {title: clean(document.title).slice(0, 180), headings, text: clean(document.body?.innerText).slice(0, 1500), inputs};
  }}).catch(() => []);
  return frame?.result || null;
}
async function askAboutOutcome(tabId, tab, reading, gate, pressAt) {
  const jobKey = `job:${tabId}`;
  const {[jobKey]: job} = await chrome.storage.session.get(jobKey);
  if (!job) {
    logOnce(tabId, 'submit, then the page changed, no job stored on this tab: not marked', {host: gate.host, path: gate.path});
    return {done: true};
  }
  decide('submitted?', `submit, then the page changed (${gate.why}): asking whether it confirms`, {host: gate.host, path: gate.path});
  try {
    const config = await settings();
    const verdict = await api(config, '/extension/confirmation', {method: 'POST', body: JSON.stringify({
      job, page: pageKey(tab.url), title: reading?.title || '', headings: reading?.headings || [], text: reading?.text || '', inputs: reading?.inputs || 0,
    })});
    if (!verdict.confirmation) {
      decide('submitted?', verdict.error ? `page not read (${verdict.error}): not marked` : 'page is not a confirmation: not marked', {host: gate.host, path: gate.path});
      return {done: false};
    }
    if (!verdict.ok) {
      decide('submitted', `the app refused it: ${verdict.error || 'not marked'}`, {host: gate.host, path: gate.path});
      return {done: true};
    }
    await chrome.storage.session.set({[`judged:${tabId}`]: pressAt});
    await chrome.storage.session.remove(`submit:${tabId}`);
    decide('submitted', 'marked Applied', {host: gate.host, path: gate.path});
    await note(tabId, '✈️ Submitted: marked Applied in Job Pilotto and Notion.', pageKey(tab.url));
    return {done: true};
  } catch (error) {
    decide('submitted', `could not reach the app: ${error.message}`, {host: gate.host, path: gate.path});
    await note(tabId, `✈️ Submitted, but Job Pilotto couldn't reach the app to mark it Applied (${error.message}). Use the extension's "I submitted it" button.`, pageKey(tab.url));
    return {done: true};
  }
}
// One watch per tab. Samples the page until it changes and settles, or the wait runs out. A second sample
// is allowed when the first read was a loading state rather than the outcome.
async function watchSubmission(tabId) {
  const key = `submit:${tabId}`;
  let {[key]: submit, [`judged:${tabId}`]: judged} = await chrome.storage.session.get([key, `judged:${tabId}`]);
  if (!submit?.at || judged === submit.at || submit.closed) return;
  if (watching.get(tabId) === submit.at) return;
  const pressAt = submit.at;
  watching.set(tabId, pressAt);
  try {
    const armedKey = `armed:${tabId}`;
    let last = submit.fingerprint;
    let stableSince = Date.now();
    let calls = submit.calls || 0;
    const deadline = pressAt + SUBMIT_WAIT_MS;
    // Sleep only until the deadline, then take that sample. A sample a few milliseconds later would be
    // "too old" and would skip both the read and the "page unchanged" line.
    while (calls < ASK_LIMIT && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
      const fresh = await chrome.storage.session.get([key, `judged:${tabId}`]);
      submit = fresh[key];
      if (submit?.at !== pressAt || fresh[`judged:${tabId}`] === pressAt) return; // a newer press, or already marked
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab?.url || !/^https:/.test(tab.url)) return;
      const {[armedKey]: armed} = await chrome.storage.session.get(armedKey);
      if (!tabArmed({url: tab.url, armed})) return;
      const reading = await readLandedPage(tabId);
      const after = pageFingerprint(reading || {});
      if (after !== last) { last = after; stableSince = Date.now(); }
      const now = Math.min(Date.now(), deadline);
      const gate = submissionOutcome({
        at: pressAt, now, from: submit.url, to: tab.url, before: submit.fingerprint, after, stableFor: now - stableSince,
      });
      if (gate.why === 'unchanged') {
        await chrome.storage.session.set({[key]: {...submit, closed: true}});
        logOnce(tabId, 'submit, page unchanged: not marked', {host: gate.host, path: gate.path});
        return;
      }
      // A blank document mid-navigation is not the outcome. Wait for content, unless this is the last sample.
      const blank = !reading || (!reading.title && !reading.text && !(reading.headings || []).length);
      if (!gate.ask || (blank && now < deadline)) continue;
      calls += 1;
      submit = {...submit, fingerprint: after, calls, ...(calls >= ASK_LIMIT ? {closed: true} : {})};
      await chrome.storage.session.set({[key]: submit});
      const result = await askAboutOutcome(tabId, tab, reading, gate, pressAt);
      if (result.done) {
        const latest = await chrome.storage.session.get(key);
        if (latest[key]?.at === pressAt) await chrome.storage.session.set({[key]: {...latest[key], closed: true}});
        return;
      }
      stableSince = Date.now();
    }
  } finally {
    if (watching.get(tabId) === pressAt) watching.delete(tabId);
  }
}
async function onTabSettled(tabId, tab) {
  if (!tab?.url || !/^https:/.test(tab.url)) return;
  const armedKey = `armed:${tabId}`;
  const stored = await chrome.storage.session.get([`job:${tabId}`, `submit:${tabId}`, `judged:${tabId}`, armedKey]);
  if (!tabArmed({url: tab.url, armed: stored[armedKey]})) return;
  const submit = stored[`submit:${tabId}`];
  if (submit?.at && !submit.closed && stored[`judged:${tabId}`] !== submit.at && Date.now() - submit.at < SUBMIT_WAIT_MS) {
    watchSubmission(tabId);
    return;
  }
  const job = stored[`job:${tabId}`];
  const miss = missedConfirmation({url: tab.url, job});
  if (miss) logOnce(tabId, miss.text, miss.fields);
  else if (!submit?.at && job && confirmationOf(tab.url)) logOnce(tabId, 'no submit press before this page: not marked', {host: confirmationOf(tab.url).host, path: confirmationOf(tab.url).path});
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete') onTabSettled(tabId, tab); });

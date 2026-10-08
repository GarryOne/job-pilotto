// The background worker: tabs the app opens to fill (#jobpilotto-fill), the next page in that tab, a tab that tab
// opens, Apply with Claude's hand-off, the ring's messages to the app, and the connection check. The result of a
// fill shows in a panel on the page and in the icon badge.
import {JOB_SITES, NOT_CONNECTED, NO_APP, api, fillTab, forgetAI, settings} from './flow.js';
import {ensureAlarm} from './report-alarm.js';
import {decide, pushDecisions} from './log.js';
import {accountSkip, onAccountPage, roleOf} from './account.js';
import {closePosting, followOpener} from './tabs.js';
import {consider, fillKey, initFillFlow} from './fill-flow.js';
import {autoRead, markListed, readSite, readingNow, siteUnreachable, startWaiting} from './visit.js';
import {TIPS} from './tips-pool.js';
import {MEMORY_KEY, memoryReadyIs, sessionGet, snapshot, startRun} from './tab-memory.js';
import {startsOwnJob, confirmationOf, missedConfirmation, pageFingerprint, pageKey, sameSite, submissionOutcome, SUBMIT_WAIT_MS, LATE_CONFIRMATION_MS, forJob, navigationKind, neverForm, readTabs, reportedIds, sharedFixNote, sharedFixes, tabArmed, withMark} from './tab-pages.js';

// The tab we may touch: Chrome reuses a tab id after its tab closes, and the user can navigate the tab elsewhere
// while a fill is still running, so every injection asks the tab what it shows first (tab-pages.js).
async function onPage(tabId, url) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return sameSite(tab?.url, url) ? tab : null;
}

// What the extension decided, and why: log.js (decide), kept and pushed to the app's log.
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
  // A mark added to a tab already open changes only its address (a hash change: no loading status).
  if (info.status !== 'loading' && info.status !== 'complete' && !info.url?.includes(`#${FILL_MARK}`)) return;
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
  // `from` is the job this tab was opened for. A mark the extension carried onto the next page (markPage) does not change it:
  // the posting that led to an agency's form stays the job, whichever site the form is on.
  const carried = (await sessionGet(`carried:${tabId}`))[`carried:${tabId}`];
  // A page the app opened starts its own job: nothing a tab that happened to open it handed over (followOpener) stays. The same page
  // loading again (a form's own result after Submit) is not a new start: its job must stay, or the confirmation has no job to mark.
  if (carried !== tab.url) {
    const prior = (await sessionGet(`from:${tabId}`))[`from:${tabId}`];
    if (!startsOwnJob(prior, tab.url)) { /* same page again: keep its job */ } else {
      // Nor the session a tab that happened to be active handed it (8 Oct 2026, e2e: the app's new tab for one job reported as another job's).
      await chrome.storage.session.remove([`job:${tabId}`, `session:${tabId}`]);
      await chrome.storage.session.set({[`from:${tabId}`]: tab.url.replace(`#${FILL_MARK}`, '')});
    }
  }
  await arm(tabId, 'fill mark');  // while the document loads, so Apply with Claude finds the hook
  if (info.status !== 'complete') return;
  // The job, not this page: a page the extension carried the mark onto (an agency's form) belongs to the posting that led to it.
  await consider(tab, await jobOf(tab));
});

async function jobOf(tab) {
  const stored = await sessionGet([`from:${tab.id}`, `job:${tab.id}`]);
  return stored[`job:${tab.id}`] || stored[`from:${tab.id}`] || pageKey(tab.url);
}
// The panel is injected only into a tab the desktop app opened, a later page in that tab, or a tab that tab
// opened. A new document gets the scripts again. Nothing is injected into a tab the user opened themselves.
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
  await chrome.scripting.executeScript({target: {tabId, allFrames: true}, files: ['page/skeleton.js', 'page/coverage.js', 'hook.js', 'review.js'], injectImmediately: true}).catch(() => {});
}
// The mark in the address is what makes a page ours. A server redirect keeps it (a browser carries the #fragment through a
// redirect). When an application tab moves on by itself (a link, a form, a script) and the new address has none, the mark is
// put back in place, without a reload. When a person walks away (types an address, searches, opens a bookmark), the tab is
// let go. Without the permission this needs, tabs stay armed until closed (webNavigation).
const forget = tabId => chrome.storage.session.remove([`armed:${tabId}`, `from:${tabId}`, `job:${tabId}`, `carried:${tabId}`, `submit:${tabId}`, `judged:${tabId}`]).catch(() => {});
async function markPage(tabId, url) {
  const marked = withMark(url);
  if (!marked) return false;
  await chrome.storage.session.set({[`carried:${tabId}`]: marked});
  await chrome.scripting.executeScript({target: {tabId}, args: [marked], func: address => { try { history.replaceState(history.state, '', address); } catch { /* sandboxed page */ } }}).catch(() => {});
  return true;
}
if (chrome.webNavigation) {
  // A site on the app's visit list lights the icon ("Read"): no access to the page is needed for that (visit.js).
  // Read as soon as the page's own content is there (DOMContentLoaded), not only when every image and script has loaded (onCompleted):
  // 7 Oct 2026: Tiffany's site took longer than the app's 30 s to "complete", and the app skipped it as "it never started reading".
  // autoRead runs once a tab, whichever comes first.
  const readWhenLoaded = details => {
    if (details.frameId !== 0 || !/^https?:/.test(details.url)) return;
    if (/#jp-read(-filter)?(-[a-z0-9]{4,16})?$|#jp-posting-[a-z0-9]{4,16}$/.test(details.url)) { autoRead(details.tabId, details.url); return; }   // a tab the app opened to read (Actions)
    // A site that redirected and dropped the mark (iwc.com to iwc.com/ch-en, 7 Oct 2026: the tab sat there unread): the mark it was opened with.
    const key = `readmark:${details.tabId}`;
    sessionGet(key).then(kept => {
      if (kept[key]) autoRead(details.tabId, `${details.url.split('#')[0]}${kept[key]}`);
      else if (details.complete) markListed(details.tabId, details.url);
    }).catch(() => { if (details.complete) markListed(details.tabId, details.url); });
  };
  chrome.webNavigation.onDOMContentLoaded.addListener(readWhenLoaded);
  chrome.webNavigation.onCompleted.addListener(details => readWhenLoaded({...details, complete: true}));
  // A site the app opened that cannot be reached: the app hears it at once (visit.js siteUnreachable), with the mark kept if it redirected first.
  chrome.webNavigation.onErrorOccurred.addListener(details => {
    if (details.frameId !== 0) return;
    if (/#jp-read(-filter)?-[a-z0-9]{4,16}$/.test(details.url)) { siteUnreachable(details.tabId, details.url, details.error); return; }
    const key = `readmark:${details.tabId}`;
    sessionGet(key).then(kept => { if (kept[key]) siteUnreachable(details.tabId, `${details.url.split('#')[0]}${kept[key]}`, details.error); }).catch(() => {});
  });
  // The mark of a tab the app opened to read, kept for the tab: its next pages may have lost it (a redirect).
  chrome.webNavigation.onBeforeNavigate.addListener(details => {
    const found = details.frameId === 0 && /#jp-(?:read(?:-filter)?|posting)(?:-([a-z0-9]{4,16}))?$/.exec(details.url);
    if (!found) return;
    chrome.storage.session.set({[`readmark:${details.tabId}`]: found[0]}).catch(() => {});
    // The app hears at once that the extension has the tab (its site row says so, and it is not silence): "never started reading" then
    // means the extension never saw it (an old version, the extension off), not a slow page.
    if (found[1]) settings().then(config => api(config, '/extension/visit-state', {method: 'POST', body: JSON.stringify({ticket: found[1], words: 'the extension has the tab: waiting for the page to load'})})).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove(`readmark:${tabId}`).catch(() => {}); });
  chrome.permissions.onAdded.addListener(() => startWaiting());
  chrome.webNavigation.onCommitted.addListener(async details => {
    if (details.frameId !== 0) return;
    const key = `armed:${details.tabId}`;
    if (!(await sessionGet(key))[key] || String(details.url).includes(`#${FILL_MARK}`)) return;
    let host = '';
    try { host = new URL(details.url).hostname; } catch { /* not a url */ }
    if (navigationKind(details) === 'by-hand') {
      await forget(details.tabId);
      decide('panel', 'tab left by hand: no longer the application', {host});
      return;
    }
    if (await markPage(details.tabId, details.url)) decide('panel', 'mark carried to the next page', {host});
  });
}
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !/^https:/.test(tab.url || '') || tab.url.includes(`#${FILL_MARK}`)) return;
  const key = `armed:${tabId}`;
  // Notion is where the kit lives, never a form: an armed tab sent there is let go (no panel, no fill) until the app arms it again.
  if (neverForm(tab.url)) {
    if ((await sessionGet(key))[key]) {
      await chrome.storage.session.remove([key, `from:${tabId}`, `job:${tabId}`, `submit:${tabId}`, `judged:${tabId}`]).catch(() => {});
      decide('panel', 'tab left for Notion: no longer armed', {host: new URL(tab.url).hostname});
    }
    return;
  }
  if (!(await sessionGet(key))[key]) return;
  await markPage(tabId, tab.url);
  await arm(tabId, 'next page');
  await consider(tab, await jobOf(tab));
});
chrome.tabs.onCreated.addListener(async tab => {
  if (!(await followOpener(tab))) return;
  let host = '';
  try { host = new URL(tab.pendingUrl || tab.url || '').hostname; } catch { /* the address is not ready yet */ }
  decide('panel', 'following a tab this session opened', {host, why: 'child'});
  await closePosting(tab, host);
  // A page that loads faster than the lines above finish (a local or cached one) completed before this tab was armed, and the load listener above
  // let it go: nothing looks at it again. Look now, if it is already loaded; `consider` runs a page only once, so a page still loading is not doubled.
  const live = await chrome.tabs.get(tab.id).catch(() => null);
  if (live?.status !== 'complete' || !/^https:/.test(live.url || '') || live.url.includes(`#${FILL_MARK}`) || neverForm(live.url)) return;
  await markPage(live.id, live.url);
  await arm(live.id, 'next page');
  await consider(live, await jobOf(live));
});

// A progress panel on the page while a tab fills itself (the popup is closed then). `url`: the page being filled —
// nothing is drawn when that tab has moved on to another site (or its id came back as a different tab).
async function progress(tabId, text, url = '') {
  if (url && !(await onPage(tabId, url))) return;
  // The page's panel (review.js) shows it when it is there; the floating box is for pages without one. Whichever
  // takes it, the other is cleared: a box drawn before the panel opened used to stay on the page for good, above a
  // form that was already "Ready to submit" (1 Oct 2026).
  if (text) stepNow.set(tabId, text); else stepNow.delete(tabId);
  const shown = await chrome.tabs.sendMessage(tabId, {type: 'panelStep', text}).catch(() => null);
  await stepBox(tabId, shown?.shown ? '' : text);
}
// The step a fill is on, per tab: a panel that appears after the step was announced (the fill started before the page
// had one) asks for it, shows it itself, and the floating box goes (2 Oct 2026: both were on screen for the whole wait).
const stepNow = new Map();

// The floating step box: drawn, updated, or (with no text) removed. Only for pages whose panel can't show the step.
function stepBox(tabId, message) {
  return chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', args: [message], func: message => {
    let box = document.getElementById('jobpilotto-progress');
    // The panel (review.js) shows the step itself: never a second copy of it in the corner.
    if (!message || document.getElementById('jobpilotto-review-host')) { box?.remove(); return; }
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
const ME_FRESH_MS = 5000;
function prefetch(config, url) {
  const known = early.get(url);
  if (known && Date.now() - known.at < FRESH_MS) return known;
  const entry = {at: Date.now(), meAt: Date.now(),
    kit: api(config, `/extension/kit?url=${encodeURIComponent(url)}`),
    me: api(config, `/extension/me?url=${encodeURIComponent(url)}`)};
  entry.kit.catch(() => early.delete(url));
  entry.me.catch(() => early.delete(url));
  // Details that came with an error (Notion failed) aren't kept: the next Fill asks the app again.
  entry.me.then(me => { if (me?.contactError) early.delete(url); }, () => {});
  early.set(url, entry);
  return entry;
}

// How the generic operators fared on this form (kind, fingerprint, worked or not, why): the app turns the failures into
// reports that help everyone. No questions, no answers.
// `trace` carries only the rows no answer matched (the form's own wording: the app cleans it and drops what could be personal).
function reportControls(config, tab, operated, trace, card = null) {
  // Every fill counts for the board it was on, even when the operators had nothing to do there.
  if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;
  let host = '';
  try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
  // Every field left and why, so the app counts each reason per board (lib/question-labels.js leftCounts); the wording only of
  // the rows no answer matched (the app learns it), never of the others.
  const unplaced = (Array.isArray(trace) ? trace : []).filter(row => row && row.outcome !== 'filled' && row.reason && row.type !== 'file').slice(0, 25)
    .map(row => ({label: row.reason === NO_ANSWER ? String(row.label || '').slice(0, 100) : '', type: String(row.type || '').slice(0, 20),
      required: !!row.required, outcome: 'left', reason: String(row.reason).slice(0, 80)}));
  // Which service meanings placed a question, and whether the field took the value (counts only: the canary's evidence).
  const aliasUse = (Array.isArray(trace) ? trace : []).filter(row => row && row.alias).slice(0, 20).map(row => ({phrase: String(row.alias).slice(0, 60), ok: row.outcome === 'filled'}));
  // The questions the fill did answer (form wording only), so corrections can be counted against them.
  const filled = (Array.isArray(trace) ? trace : []).filter(row => row && row.outcome === 'filled' && row.source && row.type !== 'file').slice(0, 30).map(row => String(row.label || '').slice(0, 100));
  // How many required questions the form had (the CV and consents aside): the denominator of the per-board rates.
  const required = (Array.isArray(trace) ? trace : []).filter(row => row && row.required && row.type !== 'file' && !/^legal/.test(String(row.reason || ''))).length;
  api(config, '/extension/controls', {method: 'POST', body: JSON.stringify({host, items: (Array.isArray(operated) ? operated : []).slice(0, 20), trace: unplaced, aliasUse, filled, required,
    ...(card ? {card} : {})})}).catch(() => {});
}
// Labels of filled fields the person later changed by hand (page/fill.js watchCorrection): sent once, then forgotten.
async function reportCorrections(config, tabId) {
  const frames = await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: () => (window.__jobPilottoCorrections || []).splice(0)}).catch(() => []);
  const corrections = frames.flatMap(frame => frame.result || []).slice(0, 40);
  if (!corrections.length) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  let host = '';
  try { host = new URL(tab?.url).hostname; } catch { /* not a url */ }
  api(config, '/extension/controls', {method: 'POST', body: JSON.stringify({host, items: [], corrections})}).catch(() => {});
}
// Where an application got to on this page (a form, a page with no form, an account wall): counted per board, nothing else.
async function reportFlow(tab, flow, extra = {}) {
  try {
    const config = await settings();
    if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;
    let host = '';
    try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
    await api(config, '/extension/controls', {method: 'POST', body: JSON.stringify({host, items: [], ...(flow ? {flow} : {}), ...extra})});
  } catch { /* the app is closed */ }
}
const NO_ANSWER = 'no answer in the kit, Profile or your details';

// fast: the page is already there (the panel's Fill): no wait for it to render.
// Fills running now, by tab: an update waits for them (a reload mid-fill ended Claude's answers and reset the panel, 8 Oct 2026).
const fillsNow = new Set();
async function fillOpenedTab(tab, ...rest) {
  fillsNow.add(tab.id);
  try { return await fillOpenedTabNow(tab, ...rest); } finally { fillsNow.delete(tab.id); }
}
async function fillOpenedTabNow(tab, url, force = false, {fast = false, quiet = false} = {}) {
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
    // Your details and CV are read again when the prefetch is more than a few seconds old: a CV tailored (or a detail edited) since the form
    // was first seen must be the one attached, not the copy kept for 10 minutes (found by the e2e apply suite, 3 Oct 2026).
    if (Date.now() - ready.meAt > ME_FRESH_MS) { ready.me = api(config, `/extension/me?url=${encodeURIComponent(url)}`); ready.meAt = Date.now(); }
    const me = await ready.me.catch(() => null);  // missing: fillTab fetches it and says what's wrong
    const result = await fillTab(tab, config, {jobUrl: url, kitAnswers: kit.kit?.answers || [], hasKit: !!kit.kit, coverLetter: kit.kit?.cover_letter || '', force, me,
      onStep: text => progress(tab.id, text, page)});
    reportControls(config, tab, result?.operated, result?.trace, result?.card);
    // The kit's eligibility verdict, as a reminder (applying anyway was the user's choice).
    if (kit.kit?.eligible === false) await note(tab.id, `⛔ Reminder from your kit: ${kit.kit.eligibility_note}`, page);
    // Claude could not answer the form's own questions (not answering, a limit, no key): the fill went on without them and the panel said
    // "Ready to submit" with the free-text questions empty (a friend's Ashby form, 2 Oct 2026). Say so on the page, in the log, and to the app.
    if (result?.aiError) {
      const why = String(result.aiError).slice(0, 160);
      decide('fill', 'Claude did not answer the questions', {error: why});
      await note(tab.id, `✈️ Claude couldn't answer the questions this form asks (${why}). Answer them yourself, or press Fill again.`, page);
      api(config, '/extension/event', {method: 'POST', body: JSON.stringify({type: 'ai-failed', url, host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })(), why})}).catch(() => {});
    }
    await progress(tab.id, '', page);
    if (result.ineligible && await onPage(tab.id, page)) await ineligibleNote(tab.id, result.note);
    decide('fill', result.ineligible ? `did not fill: ${result.note || 'ineligible'}` : 'filled the form',
      {url: page, ineligible: !!result.ineligible});
    chrome.action.setBadgeText({tabId: tab.id, text: result.ineligible ? '!' : '✓'}).catch(() => {});  // the tab may already be closed
    return result;
  } catch (error) {
    await progress(tab.id, '', page);
    decide('fill', `failed: ${error.message}`, {url: page});
    // An automatic fill (the page was not asked for by you, just reached in an armed tab) fails quietly: logged, never a popup.
    if (!quiet) await note(tab.id, `✈️ Job Pilotto couldn't fill this page: ${error.message}. If the form is behind an "Apply" button, open that form from the Job Pilotto app.`, page);
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
  // "Read the jobs on this page", from the popup after the person's click (visit.js): runs here so it goes on when the popup closes.
  if (message?.type === 'visitRead') {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) { reply({ok: false}); return false; }
    readSite(tabId, {filter: !!message.filter}).then(state => reply({ok: true, ...state}), error => reply({ok: false, error: error.message}));
    return true;
  }
  // Review in form, for a tab Claude opened (no fill mark): inject the panel. Do not fill again, and do not reload.
  if (message?.type === 'armTab') {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) { reply({ok: false}); return false; }
    arm(tabId, 'review').then(() => reply({ok: true}), () => reply({ok: false}));
    return true;
  }
  // Controls the panel could not read (their structure, never their text): kept on this Mac for learning how to operate them.
  if (message?.type === 'misses' && sender.tab && Array.isArray(message.items)) {
    (async () => {
      const config = await settings();
      if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {ok: false};
      let host = '';
      try { host = new URL(sender.tab.url).hostname; } catch { /* not a url */ }
      return api(config, '/extension/misses', {method: 'POST', body: JSON.stringify({host, items: message.items.slice(0, 10)})});
    })().then(reply, () => reply({ok: false}));
    return true;
  }
  // What you answered yourself in the form, sent at the Submit press: the app keeps it so no form asks again.
  if (message?.type === 'learned' && sender.tab && Array.isArray(message.items)) {
    (async () => {
      if (await onAccountPage(sender.tab, message.account, message.url)) { accountSkip(sender.tab, 'answers typed there are not learned'); return {ok: false, account: true}; }
      const config = await settings();
      if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {ok: false};
      let host = '';
      try { host = new URL(sender.tab.url).hostname; } catch { /* not a url */ }
      const items = message.items.slice(0, 40).map(item => ({label: String(item?.label || '').slice(0, 120), value: String(item?.value || '').slice(0, 300),
        kind: item?.kind === 'option' ? 'option' : 'text'})).filter(item => item.label && item.value);
      return api(config, '/extension/learned', {method: 'POST', body: JSON.stringify({host, job: await jobOf(sender.tab), items})});
    })().then(reply, () => reply({ok: false}));
    return true;
  }
  if (message?.type === 'focusResult' && sender.tab) {
    (async () => {
      const config = await settings();
      if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {ok: false};
      return api(config, '/extension/focus', {method: 'POST', body: JSON.stringify({
        url: sender.tab.url, title: sender.tab.title || '', found: !!message.found, job: await jobOf(sender.tab)})});
    })().then(reply, () => reply({ok: false}));
    return true;
  }
  if (message?.type === 'panelStepNow' && sender.tab) {
    const text = stepNow.get(sender.tab.id) || '';
    if (text) stepBox(sender.tab.id, '');
    reply({text});
    return false;
  }
  if (message?.type === 'panelAllowed' && sender.tab) {
    const key = `armed:${sender.tab.id}`;
    sessionGet(key).then(stored => {
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
  // At Submit, what the fill missed (review.js noteMissed): labels and kinds only, counted per board by the app.
  if (message?.type === 'formLearning' && sender.tab) {
    const labels = list => (Array.isArray(list) ? list : []).slice(0, 30);
    const byYou = labels(message.byYou).map(item => ({label: String(item?.label || '').slice(0, 120), kind: String(item?.kind || '').slice(0, 20), unread: !!item?.unread}));
    const invalid = labels(message.invalid).map(label => String(label || '').slice(0, 120));
    const fillId = /^[\w-]{8,40}$/.test(String(message.fillId || '')) ? message.fillId : '';
    // What the fill missed teaches the form-filling data (recipes, the board's misses): never from a sign-in or sign-up page.
    onAccountPage(sender.tab, message.account, message.url).then(account => {
      if (account) { accountSkip(sender.tab, 'its fields are not counted as fill misses'); return; }
      reportFlow(sender.tab, null, {...(byYou.length ? {byYou} : {}), ...(invalid.length ? {invalid} : {}), ...(fillId ? {fillId, submitted: !!message.submitted} : {})});
    });
    reply({ok: true});
    return false;
  }
  if (message?.type === 'submitted' && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    const url = pageKey(message.url || sender.tab.url || '');
    const at = Date.now();
    const fingerprint = pageFingerprint(message.snapshot || {});
    const where = submissionOutcome({at, from: url, to: url, before: fingerprint, after: fingerprint});
    // "Create account" or "Sign in" is not the application being sent: its "thanks for registering" must never mark it Applied.
    onAccountPage(sender.tab, message.account, message.url).then(account => {
      if (account) { decide('submitted', 'account page: a sign-in or sign-up press, not an application submit', {host: where.host, path: where.path}); return; }
      chrome.storage.session.set({[`submit:${tabId}`]: {at, url, fingerprint, calls: 0}}).then(() => watchSubmission(tabId)).catch(() => {});
      decide('submitted', 'submit pressed', {host: where.host, path: where.path});
    });
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
      filled: result?.filled || 0, todo: (result?.todo || []).slice(0, 20), coverLetter: result?.coverLetter || '',
      sharedNote: sharedFixNote(sharedFixes(result?.operated))}));
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
  // "Take over with Claude": the person asks the app to start its Claude session for this application, from this page. The job is the
  // posting that led here (jobOf), the page is where Claude picks up.
  if (message?.type === 'panelTakeOver' && sender.tab) {
    (async () => {
      const job = String(await jobOf(sender.tab)).split('#')[0];
      const host = (() => { try { return new URL(sender.tab.url).hostname; } catch { return ''; } })();
      decide('panel', 'asked Claude to take over', {host});
      const data = await api(await settings(), '/extension/event', {method: 'POST', body: JSON.stringify({type: 'take-over', url: job, page: sender.tab.url.split('#')[0], host})});
      reply({ok: !!data?.ok});
    })().catch(() => reply({ok: false}));
    return true;
  }
  // The form panel's tip line: one tip from the same pool as the app's Application sessions page, the least recently shown, for this application system and, when
  // one fits, the topic the form is at (knockout questions, tailoring, the CV).
  if (message?.type === 'panelTip') {
    (async () => {
      const host = String(message.host || ''), ats = /greenhouse\.io$/.test(host) ? 'greenhouse' : /lever\.co$/.test(host) ? 'lever' : /ashbyhq\.com$/.test(host) ? 'ashby'
        : /myworkdayjobs\.com$|workday\.com$/.test(host) ? 'workday' : /smartrecruiters\.com$/.test(host) ? 'smartrecruiters' : '';
      const {tipsSeen = []} = await chrome.storage.local.get('tipsSeen');
      const fits = TIPS.filter(tip => !tip.for && (!tip.ats || tip.ats === ats));   // a tip with an IT example is for the app, which knows the candidate
      const topical = fits.filter(tip => tip.category === message.prefer);
      const pool = topical.length ? topical : fits;
      const next = [...pool].sort((a, b) => tipsSeen.indexOf(a.id) - tipsSeen.indexOf(b.id) || (Math.random() - 0.5))[0];   // never shown first, then the oldest
      if (!next) return reply({ok: false});
      await chrome.storage.local.set({tipsSeen: [...tipsSeen.filter(id => id !== next.id), next.id].slice(-60)});
      reply({ok: true, text: next.text, evidence: next.evidence});
    })().catch(() => reply({ok: false}));
    return true;
  }
  // "Tailor my CV for this job": the person asks the app to write a CV from this job's posting; the form is filled again afterwards.
  if (message?.type === 'panelTailor' && sender.tab) {
    (async () => {
      const job = String(await jobOf(sender.tab)).split('#')[0];
      decide('panel', 'asked the app to tailor the CV', {});
      const data = await api(await settings(), '/extension/event', {method: 'POST', body: JSON.stringify({type: 'tailor-cv', url: job, page: sender.tab.url.split('#')[0]})});
      reply({ok: !!data?.ok});
    })().catch(() => reply({ok: false}));
    return true;
  }
  if (message?.type === 'panelOpenApp') {
    settings().then(config => api(config, '/extension/open', {method: 'POST', body: JSON.stringify({session: message.session})}))
      .then(data => reply({ok: !!data.ok}), () => reply({ok: false}));
    return true;
  }
  // The form page's ring (review.js): what's left there, to the app's session page; back: what to watch and show.
  // A sign-in or sign-up page in a tab the app opened: its empty password boxes are filled from the Keychain (owner, 8 Oct 2026),
  // as a browser's password manager would. The site is Chrome's own tab address, not the page's word; the value goes into the
  // boxes only, never back to the page's scripts or the panel.
  if (message?.type === 'sitePassword' && sender.tab) {
    (async () => {
      const key = `armed:${sender.tab.id}`;
      const stored = await sessionGet(key);
      if (!tabArmed({url: sender.tab.url, armed: stored[key]})) return {filled: 0};
      const host = new URL(sender.tab.url).hostname;
      const config = await settings();
      if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {filled: 0};   // your own Worker: no Keychain
      const answer = await api(config, '/extension/site-password', {method: 'POST', body: JSON.stringify({host})});
      if (!answer?.ok || !answer.password) return {filled: 0};
      const [result] = await chrome.scripting.executeScript({target: {tabId: sender.tab.id, frameIds: [sender.frameId ?? 0]}, args: [answer.password], func: password => {
        let filled = 0;
        for (const box of document.querySelectorAll('input[type=password]')) {
          if (box.disabled || box.readOnly || box.value || !box.getClientRects().length) continue;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, password);   // React/Vue see the change too
          box.dispatchEvent(new Event('input', {bubbles: true}));
          box.dispatchEvent(new Event('change', {bubbles: true}));
          box.setAttribute('data-jobpilotto-filled', '1');
          filled++;
        }
        return filled;
      }});
      decide('fill', 'password filled from the Keychain', {host, boxes: result?.result || 0});
      return {filled: result?.result || 0};
    })().then(reply, () => reply({filled: 0}));
    return true;
  }
  if (message?.type === 'review' && sender.tab) {
    (async () => {
      const config = await settings();
      if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {matched: null};  // your own Worker: no app
      // The session this tab belongs to travels with it (next pages, tabs it opens): the app uses it instead of guessing.
      const key = `session:${sender.tab.id}`, carried = (await sessionGet(key))[key] || '';
      const answer = await api(config, '/extension/review', {method: 'POST', body: JSON.stringify({...(message.payload || {}), tab: sender.tab.id, boot: await bootId(), job: await jobOf(sender.tab), session: carried,
        role: await roleOf(sender.tab.id, sender.tab.url)})});   // the page type by the one rule (an account page never counts as the form's progress)
      if (answer?.matched && answer.matched !== carried) await chrome.storage.session.set({[key]: answer.matched});
      return answer;
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
  await memoryReady;   // the armed: marks of the worker before a reload
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const tab of tabs) {
    if (tab.id == null || !/^https:/.test(tab.url || '')) continue;
    const key = `armed:${tab.id}`;
    const armed = tabArmed({url: tab.url, armed: (await sessionGet(key).catch(() => ({})))[key]});
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

// This worker's own id: Chrome may stop the worker and start a new one, and every reading in progress dies with the old one; the app hands
// those tabs back when the id changes.
const WORKER = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// This browser run's id, and the tabs' memory (extension/tab-memory.js), settled once per worker before anything reads them: several reports
// at a worker's start each made their own id before (7 Oct 2026, 22:05:39: three ids in half a second, the app took each for a restart).
// A worker that finds the run's id in session storage is the same run (Chrome stopped and started the worker). Empty: the extension was
// reloaded (its memory is put back, the id kept) or Chrome started (a new id: tab ids start again). onStartup says which.
let sawStartup = false;
chrome.runtime.onStartup.addListener(() => { sawStartup = true; });
const memoryReady = (async () => {
  const {boot: running} = await chrome.storage.session.get('boot').catch(() => ({}));
  if (running) { decide('worker', 'worker started again in the same browser run', {worker: WORKER}); return running; }
  await new Promise(resolve => setTimeout(resolve, 300));   // a Chrome start announces itself (onStartup) as the worker begins
  const {[MEMORY_KEY]: kept} = await chrome.storage.local.get(MEMORY_KEY).catch(() => ({}));
  const run = startRun({kept, sawStartup, tabsNow: await chrome.tabs.query({}).catch(() => [])});
  const boot = run.boot || String(Date.now());
  await chrome.storage.session.set({...(run.restore || {}), boot}).catch(() => {});
  // Why this worker started is otherwise unknowable from the app's log.
  decide('worker', run.boot ? 'worker started in the same browser run: tab memory put back' : 'worker started in a new browser run',
    {worker: WORKER, why: run.why, keys: Object.keys(run.restore || {}).length});
  return boot;
})();
const bootId = () => memoryReady;
// Every read of the tabs' memory waits until it is put back (a reload's first messages come at once).
memoryReadyIs(memoryReady);   // every read of the tabs' memory (tab-memory.js sessionGet) waits until it is put back
// The live copy: written shortly after session storage changes, and right before the extension's own update reload.
async function keepMemory() {
  await memoryReady;
  const items = await chrome.storage.session.get(null);
  if (items.boot) await chrome.storage.local.set({[MEMORY_KEY]: snapshot(items, await chrome.tabs.query({}))});
}
let keepTimer = null;
chrome.storage.onChanged.addListener((_, area) => {
  if (area !== 'session') return;
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => keepMemory().catch(() => {}), 500);
});
// Tell the Job Pilotto app which job pages are open, so its Jobs list shows "Opened in Chrome" only while they are.
async function reportTabs() {
  const config = await settings();
  if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;  // your own Worker: no app here
  const open = await chrome.tabs.query({url: JOB_SITES});
  const urls = open.map(tab => tab.url);
  const stored = await sessionGet(null).catch(() => ({}));
  const armedIds = Object.keys(stored).filter(key => key.startsWith('armed:') && stored[key]).map(key => Number(key.slice(6))).filter(Number.isInteger);
  const every = await chrome.tabs.query({});
  // Read sites: the tabs reading a site, by ticket, so the app sees each one open and notices one you closed (as for a form tab).
  const kept = Object.fromEntries(Object.keys(stored).filter(key => key.startsWith('read:')).map(key => [Number(key.slice(5)), stored[key]]));
  const {reading, mark} = readTabs(every, kept);
  if (Object.keys(mark).length) await chrome.storage.session.set(Object.fromEntries(Object.entries(mark).map(([id, ticket]) => [`read:${id}`, ticket]))).catch(() => {});
  const ids = reportedIds({jobSiteIds: open.map(tab => tab.id), armedIds: [...armedIds, ...Object.values(reading)], existingIds: every.map(tab => tab.id)});
  for (const id of armedIds) reportCorrections(config, id);
  // Which tabs exist (ids), and which browser run they belong to: Chrome numbers tabs again after a restart.
  const boot = await bootId();
  // Doubles as the connection check (reconnecting by itself, see api()): a red ! on the icon while it fails.
  try {
    // Which session each open tab belongs to, from the tabs' own memory: the app binds a session to its tab from this alone, so it never
    // has to guess by address (a restarted app, a form on another site than the posting).
    const alive = new Set(every.map(tab => tab.id));
    const sessions = Object.fromEntries(Object.entries(stored).filter(([key, id]) => /^session:\d+$/.test(key) && id && alive.has(Number(key.slice(8))))
      .map(([key, id]) => [key.slice(8), String(id)]));
    const answer = await api(config, '/extension/tabs', {method: 'POST', body: JSON.stringify({urls, ids, boot, worker: WORKER, reading, sessions, version: chrome.runtime.getManifest().version})});
    connected(true);
    // Sites this extension was reading before it started again (a reload, an update, Chrome stopping its worker): read again from where each
    // tab is, under the mark it was opened with (desktop/lib/visits.js noteTabs; 7 Oct 2026: a reload left 3 of 5 sites "stopped answering").
    for (const {tab, ticket, mark} of Array.isArray(answer?.reread) ? answer.reread : []) {
      const open = await chrome.tabs.get(Number(tab)).catch(() => null);
      if (open?.url && /^https?:/.test(open.url) && /^jp-(read(-filter)?|posting)$/.test(String(mark)) && /^[a-z0-9]{4,16}$/.test(String(ticket))) {
        autoRead(open.id, `${open.url.split('#')[0]}#${mark}-${ticket}`);
      }
    }
    // The app has a newer copy of this extension (its folder was updated): load it. Once per version, so a copy
    // that can't update (a store install) doesn't reload over and over.
    // Never while a form is being filled (fillsNow) or a site is being read: a reload ends every reading at once (7 Oct 2026: an update landed mid-run and a site died); the next
    // report after the last one ends does it.
    if (answer?.latest && newer(answer.latest, chrome.runtime.getManifest().version) && !readingNow() && !fillsNow.size) {
      const {reloadedFor} = await chrome.storage.local.get('reloadedFor');
      if (reloadedFor !== answer.latest) {
        await chrome.storage.local.set({reloadedFor: answer.latest});
        await keepMemory().catch(() => {});   // the newest copy of the tabs' memory: the tabs outlive the reload (extension/tab-memory.js)
        await decide('worker', `reloading for version ${answer.latest}`);
        chrome.runtime.reload();
      }
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
  reportTabs();  // the app's session page learns that a form tab was closed without waiting for the 30 s report
  await chrome.storage.session.remove([`from:${tabId}`, `job:${tabId}`, `session:${tabId}`, `role:${tabId}`, `armed:${tabId}`, `submit:${tabId}`, `judged:${tabId}`, `read:${tabId}`]).catch(() => {});
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
// Every 30 s: an armed page that finished loading and that nothing looked at (its load event came while the worker was starting, or before the tab was armed)
// is looked at now. A page that has a fill state, or that `consider` already took, is left alone.
async function considerMissed() {
  const stored = await sessionGet(null).catch(() => ({}));
  for (const key of Object.keys(stored).filter(name => name.startsWith('armed:') && stored[name])) {
    const tab = await chrome.tabs.get(Number(key.slice(6))).catch(() => null);
    if (!tab || tab.status !== 'complete' || !/^https:/.test(tab.url || '') || neverForm(tab.url) || started.has(tab.id) || started.has(fillKey(tab.id, tab.url))) continue;
    const [row] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => document.documentElement?.dataset.jobpilottoFill || ''}).catch(() => []);
    if (!row || row.result) continue;   // unreadable, or it already has a state
    let host = '';
    try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
    decide('fill', 'a loaded page nobody had looked at: looking now', {host});
    await consider(tab, await jobOf(tab));
  }
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'report-tabs') { reportTabs(); considerMissed(); } });
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
  const {[jobKey]: job} = await sessionGet(jobKey);
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
    await note(tabId, `✈️ Submitted, but Job Pilotto couldn't reach the app to mark it Applied (${error.message}). Open Job Pilotto to mark it Applied.`, pageKey(tab.url));
    return {done: true};
  }
}
// One watch per tab. Samples the page until it changes and settles, or the wait runs out. A second sample
// is allowed when the first read was a loading state rather than the outcome.
async function watchSubmission(tabId) {
  const key = `submit:${tabId}`;
  let {[key]: submit, [`judged:${tabId}`]: judged} = await sessionGet([key, `judged:${tabId}`]);
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
      const fresh = await sessionGet([key, `judged:${tabId}`]);
      submit = fresh[key];
      if (submit?.at !== pressAt || fresh[`judged:${tabId}`] === pressAt) return; // a newer press, or already marked
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab?.url || !/^https:/.test(tab.url)) return;
      const {[armedKey]: armed} = await sessionGet(armedKey);
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
        const latest = await sessionGet(key);
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
  const stored = await sessionGet([`job:${tabId}`, `submit:${tabId}`, `judged:${tabId}`, armedKey]);
  if (!tabArmed({url: tab.url, armed: stored[armedKey]})) return;
  const submit = stored[`submit:${tabId}`];
  if (submit?.at && !submit.closed && stored[`judged:${tabId}`] !== submit.at && Date.now() - submit.at < SUBMIT_WAIT_MS) {
    watchSubmission(tabId);
    return;
  }
  const job = stored[`job:${tabId}`];
  // The watch gave up on a page that did not change in time, then the site's confirmation page arrived: read it now.
  const page = confirmationOf(tab.url);
  if (page && submit?.at && stored[`judged:${tabId}`] !== submit.at && Date.now() - submit.at < LATE_CONFIRMATION_MS && forJob(tab.url, job)) {
    const gate = {host: page.host, path: page.path, why: 'late confirmation'};
    const result = await askAboutOutcome(tabId, tab, await readLandedPage(tabId), gate, submit.at);
    if (result.done) await chrome.storage.session.set({[`submit:${tabId}`]: {...submit, closed: true}});
    return;
  }
  const miss = missedConfirmation({url: tab.url, job});
  if (miss) logOnce(tabId, miss.text, miss.fields);
  else if (!submit?.at && job && confirmationOf(tab.url)) logOnce(tabId, 'no submit press before this page: not marked', {host: confirmationOf(tab.url).host, path: confirmationOf(tab.url).path});
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete') onTabSettled(tabId, tab); });

// The fill flow (fill-flow.js) gets what lives on with this worker: the tabs a fill started on, the fill, its report, onPage.
initFillFlow({started, fillOpenedTab, reportFlow, onPage});

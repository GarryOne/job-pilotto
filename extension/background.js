// The background worker: tabs the app opens to fill (#jobpilotto-fill), Apply with Claude's hand-off, the ring's
// messages to the app, and the connection check. The result of a fill shows in a panel on the page and in the icon badge.
import {JOB_SITES, NOT_CONNECTED, NO_APP, api, fillTab, forgetAI, pair, settings} from './flow.js';
import {ensureAlarm} from './report-alarm.js';
import {forJob, samePage, sameSite} from './tab-pages.js';

// The tab we may touch: Chrome reuses a tab id after its tab closes, and the user can navigate the tab elsewhere
// while a fill is still running, so every injection asks the tab what it shows first (tab-pages.js).
async function onPage(tabId, url) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return sameSite(tab?.url, url) ? tab : null;
}

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

// "Apply to N jobs" in the desktop app opens each job with #jobpilotto-fill: every such tab fills
// itself as soon as it has loaded, in parallel, as long as the extension may run on that job site.
export const FILL_MARK = 'jobpilotto-fill';
const started = new Set();
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url?.includes(`#${FILL_MARK}`) || started.has(tabId)) return;
  const origin = new URL(tab.url).origin + '/*';
  chrome.storage.session.set({[`from:${tabId}`]: tab.url.replace(`#${FILL_MARK}`, '')});
  if (!(await chrome.permissions.contains({origins: [origin]}))) {
    // Not one of the supported job sites (flow.js JOB_SITES):
    // the extension may not touch this page by itself; the user can still click its button here.
    chrome.action.setBadgeText({tabId, text: '?'}).catch(() => {});  // the tab may already be closed
    chrome.action.setTitle({tabId, title: 'Job Pilotto: click here, then Fill this form (this site needs your click)'}).catch(() => {});  // the tab may already be closed
    return;
  }
  started.add(tabId);
  await fillOpenedTab(tab, tab.url.replace(`#${FILL_MARK}`, ''));
});

// Job boards (jobs.ch, LinkedIn, company pages…) often only link to the real form on the employer's
// application site. A tab opened from a Job Pilotto tab, or the same tab moving to another site, keeps its
// job: the form there fills with that job's kit, once per site.
chrome.tabs.onCreated.addListener(async tab => {
  if (!tab.openerTabId) return;
  const key = `from:${tab.openerTabId}`;
  const job = (await chrome.storage.session.get(key))[key];
  if (job) chrome.storage.session.set({[`from:${tab.id}`]: job});
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !/^https:/.test(tab.url || '') || tab.url.includes(`#${FILL_MARK}`)) return;
  const key = `from:${tabId}`;
  const job = (await chrome.storage.session.get(key))[key];
  if (!job) return;
  const site = new URL(tab.url).origin;
  if (site === new URL(job).origin || started.has(`${tabId} ${site}`)) return;
  if (!(await chrome.permissions.contains({origins: [site + '/*']}))) {
    chrome.action.setBadgeText({tabId, text: '?'}).catch(() => {});  // the tab may already be closed
    chrome.action.setTitle({tabId, title: 'Job Pilotto: click here, then Fill (or allow every site in Settings)'}).catch(() => {});
    return;
  }
  started.add(`${tabId} ${site}`);
  await fillOpenedTab(tab, job);
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
    chrome.action.setBadgeText({tabId: tab.id, text: result.ineligible ? '!' : '✓'}).catch(() => {});  // the tab may already be closed
    return result;
  } catch (error) {
    await progress(tab.id, '', page);
    await note(tab.id, `✈️ Job Pilotto couldn't fill this page: ${error.message}. If the form is behind an "Apply" button, open it and use the extension there.`, page);
    chrome.action.setBadgeText({tabId: tab.id, text: '!'}).catch(() => {});  // the tab may already be closed
    return {error: error.message};
  }
}

// Apply with Claude asked for a fill on this tab (hook.js): check its ticket with the app, fill, and write the
// result on the page for the session to read. It then fills what's left, checks, and stops before Submit.
async function handOff(tab, job, ticket) {
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

// hook.js on every site too, once "Work on every job site" is allowed (the job sites have it from the manifest).
const EVERY_SITE = {origins: ['https://*/*']};
async function registerHookEverywhere() {
  if (!(await chrome.permissions.contains(EVERY_SITE))) return;
  // With the ring (review.js) since 0.7.0: an older registration (hook.js only) is replaced.
  const known = await chrome.scripting.getRegisteredContentScripts({ids: ['hook-everywhere']}).catch(() => []);
  if (known.length && known[0].js?.includes('review.js')) return;
  if (known.length) await chrome.scripting.unregisterContentScripts({ids: ['hook-everywhere']}).catch(() => {});
  await chrome.scripting.registerContentScripts([{id: 'hook-everywhere', matches: EVERY_SITE.origins, js: ['hook.js', 'review.js'],
    allFrames: true, runAt: 'document_idle'}]).catch(() => {});
}
chrome.permissions.onAdded.addListener(registerHookEverywhere);
chrome.runtime.onStartup.addListener(registerHookEverywhere);
registerHookEverywhere();

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // The page's panel saw a submit press (review.js): the evidence that a submission happened in that tab.
  if (message?.type === 'submitted' && sender.tab?.id != null) {
    chrome.storage.session.set({[`submit:${sender.tab.id}`]: {at: Date.now(), url: sender.tab.url || ''}}).catch(() => {});
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

// Chrome gives an installed, updated or reloaded extension's page scripts only to pages loaded afterwards: the
// application forms already open (often half filled) get them now, without reloading the page (it could lose answers).
async function joinOpenTabs() {
  const everySite = await chrome.permissions.contains(EVERY_SITE).catch(() => false);
  const tabs = await chrome.tabs.query({url: everySite ? EVERY_SITE.origins : JOB_SITES}).catch(() => []);
  for (const tab of tabs) {
    await chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, files: ['hook.js', 'review.js']}).catch(() => {});
  }
}
chrome.runtime.onInstalled.addListener(joinOpenTabs);
chrome.runtime.onStartup.addListener(joinOpenTabs);

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
  await chrome.storage.session.remove([`from:${tabId}`, `job:${tabId}`]).catch(() => {});
  for (const key of started) if (key.startsWith(`${tabId} `)) started.delete(key);
  reportTabs();
});
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url || info.status === 'complete') reportTabs(); });
chrome.runtime.onStartup.addListener(reportTabs);
// Also every 30 s, so an app started after the tabs were opened still learns about them. Only if it isn't there
// already: creating an alarm that exists resets it, and this worker wakes far more often than every 30 s.
ensureAlarm({get: name => chrome.alarms.get(name), create: (name, info) => chrome.alarms.create(name, info)});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'report-tabs') reportTabs(); });
reportTabs();

// Submitted? After you unlock and submit, the site shows its confirmation: Greenhouse …/<job id>/confirmation,
// Lever …/<job id>/thanks, or a "thank you for applying" page. Then the job is marked Applied in the app and
// Notion (like the agent launchers' watcher), and a note confirms it on the page.
// How long a recorded submit press counts as this tab's submission (a site can take a moment to answer).
const SUBMIT_WINDOW_MS = 5 * 60 * 1000;
async function checkSubmitted(tabId, tab) {
  const key = `job:${tabId}`, from = `from:${tabId}`, sent = `submit:${tabId}`;
  const {[key]: job, [from]: filled, [sent]: submit} = await chrome.storage.session.get([key, from, sent]);
  if (!job || !tab.url) return;
  const id = job.replace(/\/+$/, '').split('/').pop();
  const confirmationUrl = new RegExp(`${id}/(confirmation|thanks)`).test(tab.url);
  // The tab must be this job's own page, its confirmation, or the page a fill opened from it. Otherwise the state is
  // stale (a tab id that came back as something else): reading its text — let alone marking Applied from it — would
  // be about a page this job has nothing to do with (1 Oct 2026: `elsewhere` matched any other host).
  if (!forJob(tab.url, job) && filled !== job) {
    await chrome.storage.session.remove([key, from, sent]);
    return;
  }
  // A submission is an event, not a phrase: the page's own content script records the press (a form's submit, or a
  // click on a submit button) — see review.js. Without that, a page that merely reads "thank you for applying" used
  // to mark a job Applied on its own (1 Oct 2026: a job was marked Applied while its form sat open, unsubmitted).
  const pressed = !!submit && Date.now() - (submit.at || 0) < SUBMIT_WINDOW_MS;
  // Two things count, both evidence rather than wording: the site's own confirmation URL for this job, or a submit
  // press this page reported. The old third path — a page whose text merely read "thank you for applying" — is what
  // marked an unsubmitted job Applied; it is gone (1 Oct 2026). A site we cannot see (no permission) leaves the
  // marking to you: "I submitted it" on the job's row.
  if (!confirmationUrl && !pressed) return;
  const why = confirmationUrl ? 'confirmation URL' : `submit press seen ${Math.round((Date.now() - submit.at) / 1000)}s before`;
  await chrome.storage.session.remove([key, sent]);  // once per job
  const config = await settings();
  try {
    const response = await fetch(`${config.workerUrl.replace(/\/$/, '')}/extension/applied`, {method: 'POST',
      headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({url: job, why, evidence: {path: confirmationUrl ? 'confirmation' : 'submit',
        pressAt: submit?.at || null, host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })(),
        version: chrome.runtime.getManifest().version}})});
    const result = await response.json().catch(() => ({}));
    await note(tabId, result.ok === false ? `✈️ Submitted, but Job Pilotto couldn't mark it Applied: ${result.error}` : '✈️ Submitted: marked Applied in Job Pilotto and Notion.');
  } catch (error) {
    await note(tabId, `✈️ Submitted, but Job Pilotto couldn't reach the app to mark it Applied (${error.message}). Use the extension's "I submitted it" button.`);
  }
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete' || info.url) checkSubmitted(tabId, tab); });

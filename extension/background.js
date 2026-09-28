// "Open & fill" from the popup's Ready to apply list: open the job, wait for it to load, fill it.
// The result shows in a panel on the page (the popup has closed by then) and in the icon badge.
import {JOB_SITES, fillTab, settings} from './flow.js';

function loaded(tabId) {
  return new Promise(resolve => {
    const done = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(done);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(done);
  });
}

async function note(tabId, text) {
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
    // Not one of the supported job sites (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable):
    // the extension may not touch this page by itself; the user can still click its button here.
    chrome.action.setBadgeText({tabId, text: '?'}).catch(() => {});  // the tab may already be closed
    chrome.action.setTitle({tabId, title: 'Job Pilotto: click here, then Fill with AI (this site needs your click)'}).catch(() => {});  // the tab may already be closed
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

// A progress panel on the page while a tab fills itself (the popup is closed then).
async function progress(tabId, text) {
  await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', args: [text], func: message => {
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
async function fillOpenedTab(tab, url, force = false) {
  await new Promise(resolve => setTimeout(resolve, 1500)); // forms render after the load event
  chrome.action.setBadgeText({tabId: tab.id, text: '…'}).catch(() => {});  // the tab may already be closed
  try {
    const config = await settings();
    const kit = await fetch(`${config.workerUrl.replace(/\/$/, '')}/extension/kit?url=${encodeURIComponent(url)}`,
      {headers: {Authorization: `Bearer ${config.token}`}}).then(r => r.json()).catch(() => ({}));
    const result = await fillTab(tab, config, {jobUrl: url, kitAnswers: kit.kit?.answers || [], coverLetter: kit.kit?.cover_letter || '', force, onStep: text => progress(tab.id, text)});
    // The kit's eligibility verdict, as a reminder (applying anyway was the user's choice).
    if (kit.kit?.eligible === false) await note(tab.id, `⛔ Reminder from your kit: ${kit.kit.eligibility_note}`);
    await progress(tab.id, '');
    if (result.ineligible) await ineligibleNote(tab.id, result.note);
    chrome.action.setBadgeText({tabId: tab.id, text: result.ineligible ? '!' : '✓'}).catch(() => {});  // the tab may already be closed
    return result;
  } catch (error) {
    await progress(tab.id, '');
    await note(tab.id, `✈️ Job Pilotto couldn't fill this page: ${error.message}. If the form is behind an "Apply" button, open it and use the extension there.`);
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
  const known = await chrome.scripting.getRegisteredContentScripts({ids: ['hook-everywhere']}).catch(() => []);
  if (!known.length) {
    await chrome.scripting.registerContentScripts([{id: 'hook-everywhere', matches: EVERY_SITE.origins, js: ['hook.js'],
      runAt: 'document_idle'}]).catch(() => {});
  }
}
chrome.permissions.onAdded.addListener(registerHookEverywhere);
chrome.runtime.onStartup.addListener(registerHookEverywhere);
registerHookEverywhere();

chrome.runtime.onMessage.addListener((message, sender, reply) => {
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
  if (message?.type !== 'openAndFill') return false;
  (async () => {
    const tab = await chrome.tabs.create({url: message.url, active: true});
    await loaded(tab.id);
    started.add(tab.id);
    await fillOpenedTab(tab, message.url);
  })();
  reply({ok: true});
  return false;
});

// Just loaded: open the settings page, which connects to the Job Pilotto Mac app by itself.
chrome.runtime.onInstalled.addListener(({reason}) => { if (reason === 'install') chrome.runtime.openOptionsPage(); });

// Tell the Job Pilotto app which job pages are open, so its Jobs list shows "Opened in Chrome" only while they are.
async function reportTabs() {
  const config = await settings();
  if (!config.workerUrl?.startsWith('http://127.0.0.1') || !config.token) return;
  const urls = (await chrome.tabs.query({url: JOB_SITES})).map(tab => tab.url);
  await fetch(`${config.workerUrl}/extension/tabs`, {method: 'POST', body: JSON.stringify({urls, version: chrome.runtime.getManifest().version}),
    headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'}}).catch(() => {});
}
chrome.tabs.onRemoved.addListener(() => reportTabs());
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url || info.status === 'complete') reportTabs(); });
chrome.runtime.onStartup.addListener(reportTabs);
// Also every 30 s, so an app started after the tabs were opened still learns about them.
chrome.alarms.create('report-tabs', {periodInMinutes: 0.5});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'report-tabs') reportTabs(); });
reportTabs();

// Submitted? After you unlock and submit, the site shows its confirmation: Greenhouse …/<job id>/confirmation,
// Lever …/<job id>/thanks, or a "thank you for applying" page. Then the job is marked Applied in the app and
// Notion (like the agent launchers' watcher), and a note confirms it on the page.
const THANKS = /thank(s| you) for (applying|your application)|application (has been )?(submitted|received)|we('ve| have) received your application/i;
async function checkSubmitted(tabId, tab) {
  const key = `job:${tabId}`;
  const job = (await chrome.storage.session.get(key))[key];
  if (!job || !tab.url) return;
  const id = job.replace(/\/+$/, '').split('/').pop();
  const confirmationUrl = new RegExp(`${id}/(confirmation|thanks)`).test(tab.url);
  const text = confirmationUrl ? '' : await chrome.scripting.executeScript({target: {tabId}, func: () => document.querySelectorAll('input:not([type=hidden]), textarea').length < 3 ? document.body?.innerText?.slice(0, 5000) || '' : ''})
    .then(([r]) => r?.result || '').catch(() => '');
  // On the employer's own application site the confirmation page doesn't carry the job board's id.
  const elsewhere = new URL(tab.url).hostname !== new URL(job).hostname;
  if (!confirmationUrl && !((tab.url.includes(id) || elsewhere) && THANKS.test(text))) return;
  await chrome.storage.session.remove(key);  // once per job
  const config = await settings();
  try {
    const response = await fetch(`${config.workerUrl.replace(/\/$/, '')}/extension/applied`, {method: 'POST',
      headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({url: job})});
    const result = await response.json().catch(() => ({}));
    await note(tabId, result.ok === false ? `✈️ Submitted, but Job Pilotto couldn't mark it Applied: ${result.error}` : '✈️ Submitted: marked Applied in Job Pilotto and Notion.');
  } catch (error) {
    await note(tabId, `✈️ Submitted, but Job Pilotto couldn't reach the app to mark it Applied (${error.message}). Use the extension's "I submitted it" button.`);
  }
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete' || info.url) checkSubmitted(tabId, tab); });

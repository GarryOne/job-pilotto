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
  if (!(await chrome.permissions.contains({origins: [origin]}))) {
    // Not one of the supported job sites (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable):
    // the extension may not touch this page by itself; the user can still click its button here.
    chrome.action.setBadgeText({tabId, text: '?'});
    chrome.action.setTitle({tabId, title: 'Job Pilotto: click here, then Fill with AI (this site needs your click)'});
    return;
  }
  started.add(tabId);
  await fillOpenedTab(tab, tab.url.replace(`#${FILL_MARK}`, ''));
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
      const b = Object.assign(document.createElement('button'), {textContent: label});
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

async function fillOpenedTab(tab, url, force = false) {
  await new Promise(resolve => setTimeout(resolve, 1500)); // forms render after the load event
  chrome.action.setBadgeText({tabId: tab.id, text: '…'});
  try {
    const config = await settings();
    const kit = await fetch(`${config.workerUrl.replace(/\/$/, '')}/extension/kit?url=${encodeURIComponent(url)}`,
      {headers: {Authorization: `Bearer ${config.token}`}}).then(r => r.json()).catch(() => ({}));
    const result = await fillTab({...tab, url}, config, {kitAnswers: kit.kit?.answers || [], force, onStep: text => progress(tab.id, text)});
    // The kit's eligibility verdict, as a reminder (applying anyway was the user's choice).
    if (kit.kit?.eligible === false) await note(tab.id, `⛔ Reminder from your kit: ${kit.kit.eligibility_note}`);
    await progress(tab.id, '');
    if (result.ineligible) await ineligibleNote(tab.id, result.note);
    chrome.action.setBadgeText({tabId: tab.id, text: result.ineligible ? '!' : '✓'});
  } catch (error) {
    await progress(tab.id, '');
    await note(tab.id, `✈️ Job Pilotto couldn't fill this page: ${error.message}. If the form is behind an "Apply" button, open it and use the extension there.`);
    chrome.action.setBadgeText({tabId: tab.id, text: '!'});
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'fillAnyway' && sender.tab) {
    fillOpenedTab(sender.tab, sender.tab.url.replace(`#${FILL_MARK}`, ''), true);
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
  await fetch(`${config.workerUrl}/extension/tabs`, {method: 'POST', body: JSON.stringify({urls}),
    headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'}}).catch(() => {});
}
chrome.tabs.onRemoved.addListener(() => reportTabs());
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url || info.status === 'complete') reportTabs(); });
chrome.runtime.onStartup.addListener(reportTabs);
// Also every 30 s, so an app started after the tabs were opened still learns about them.
chrome.alarms.create('report-tabs', {periodInMinutes: 0.5});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'report-tabs') reportTabs(); });
reportTabs();

// "Open & fill" from the popup's Ready to apply list: open the job, wait for it to load, fill it.
// The result shows in a panel on the page (the popup has closed by then) and in the icon badge.
import {fillTab, settings} from './flow.js';

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

async function fillOpenedTab(tab, url) {
  await new Promise(resolve => setTimeout(resolve, 1500)); // forms render after the load event
  chrome.action.setBadgeText({tabId: tab.id, text: '…'});
  try {
    const config = await settings();
    const kit = await fetch(`${config.workerUrl.replace(/\/$/, '')}/extension/kit?url=${encodeURIComponent(url)}`,
      {headers: {Authorization: `Bearer ${config.token}`}}).then(r => r.json()).catch(() => ({}));
    const result = await fillTab({...tab, url}, config, {kitAnswers: kit.kit?.answers || [], onStep: text => progress(tab.id, text)});
    await progress(tab.id, '');
    if (result.ineligible) await note(tab.id, `✈️ Job Pilotto didn't fill this form: ${result.note} Open the extension and choose "Fill anyway" if you still want to apply.`);
    chrome.action.setBadgeText({tabId: tab.id, text: result.ineligible ? '!' : '✓'});
  } catch (error) {
    await progress(tab.id, '');
    await note(tab.id, `✈️ Job Pilotto couldn't fill this page: ${error.message}. If the form is behind an "Apply" button, open it and use the extension there.`);
    chrome.action.setBadgeText({tabId: tab.id, text: '!'});
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
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

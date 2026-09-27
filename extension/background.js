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

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'openAndFill') return false;
  (async () => {
    const tab = await chrome.tabs.create({url: message.url, active: true});
    await loaded(tab.id);
    await new Promise(resolve => setTimeout(resolve, 1500)); // forms render after the load event
    chrome.action.setBadgeText({tabId: tab.id, text: '…'});
    try {
      const config = await settings();
      const kit = await fetch(`${config.workerUrl.replace(/\/$/, '')}/extension/kit?url=${encodeURIComponent(message.url)}`,
        {headers: {Authorization: `Bearer ${config.token}`}}).then(r => r.json()).catch(() => ({}));
      const result = await fillTab({...tab, url: message.url}, config, {kitAnswers: kit.kit?.answers || []});
      if (result.ineligible) await note(tab.id, `✈️ Job Pilotto didn't fill this form: ${result.note} Open the extension and choose "Fill anyway" if you still want to apply.`);
      chrome.action.setBadgeText({tabId: tab.id, text: result.ineligible ? '!' : '✓'});
    } catch (error) {
      await note(tab.id, `✈️ Job Pilotto couldn't fill this page: ${error.message}. If the form is behind an "Apply" button, open it and use the extension there.`);
      chrome.action.setBadgeText({tabId: tab.id, text: '!'});
    }
  })();
  reply({ok: true});
  return false;
});

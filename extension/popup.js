// The toolbar popup: whether the extension can reach the Job Pilotto app, and "Use on this tab" for a page the app
// did not open (the panel appears on its own only on a tab the desktop app opened).
import {api, settings} from './flow.js';

const $ = id => document.getElementById(id);
$('settings').addEventListener('click', event => { event.preventDefault(); chrome.runtime.openOptionsPage(); });

// The button: this tab, by hand. The click is the user gesture Chrome wants to ask for the site if it is not on the list.
$('use').addEventListener('click', async () => {
  const note = text => { $('note').textContent = text; };
  $('use').disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!/^https:/.test(tab?.url || '')) return note('Open the job application page first.');
    const origin = `${new URL(tab.url).origin}/*`;
    if (!(await chrome.permissions.contains({origins: [origin]})) && !(await chrome.permissions.request({origins: [origin]}))) return note('Chrome needs your OK for this site.');
    const answer = await chrome.runtime.sendMessage({type: 'useTab', tabId: tab.id});
    if (answer?.ok) window.close(); else note(answer?.why || 'Could not start on this tab.');
  } catch { note('Could not start on this tab.'); } finally { $('use').disabled = false; }
});

// No form on this page: the button is off, and says why (the page is read when the popup opens: the click that opened it
// lets the extension look at this tab, nothing is sent anywhere).
(async () => {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const verdict = tab?.id ? await chrome.runtime.sendMessage({type: 'tabCheck', tabId: tab.id}) : {ok: true};
    if (verdict && verdict.ok === false) { $('use').disabled = true; $('note').textContent = verdict.why; }
  } catch { /* leave the button on: the click checks again */ }
})();

(async () => {
  const config = await settings();
  const app = !config.workerUrl || config.workerUrl.startsWith('http://127.0.0.1');
  try {
    await api(config, '/extension/review', {method: 'POST', body: '{}'});  // a harmless call: matches no page, changes nothing
    $('status').classList.add('on');
    $('status').textContent = app ? 'Connected to the Job Pilotto app' : 'Connected to your Worker';
  } catch (error) {
    if (error.status && error.status !== 401) {  // it answered (your Worker has no review route): reachable
      $('status').classList.add('on');
      $('status').textContent = app ? 'Connected to the Job Pilotto app' : 'Connected to your Worker';
      return;
    }
    $('status').textContent = app ? 'The Job Pilotto app isn\'t open: the panel still shows what\'s left' : 'Your Worker isn\'t reachable';
  }
})();

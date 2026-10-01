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

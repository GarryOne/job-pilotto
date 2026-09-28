// The toolbar popup: a pointer to the page's panel (review.js), which does the work. "Show the panel on this page"
// puts it on a page where it didn't appear by itself (a site outside the job sites: this click allows it, once).
import {api, settings} from './flow.js';

const $ = id => document.getElementById(id);
$('settings').addEventListener('click', event => { event.preventDefault(); chrome.runtime.openOptionsPage(); });

$('show').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  $('show').disabled = true;
  try {
    await chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, files: ['hook.js', 'review.js']});
    window.close();
  } catch {
    $('show').disabled = false;
    $('show').textContent = 'Chrome doesn\'t allow extensions on this page';
  }
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

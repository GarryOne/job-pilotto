// The toolbar popup: whether the extension can reach the Job Pilotto app. The panel and the fill start only on a tab the desktop
// app opened (Apply); there is no way to start them by hand on another page.
import {api, settings} from './flow.js';

const $ = id => document.getElementById(id);
$('settings').addEventListener('click', event => { event.preventDefault(); chrome.runtime.openOptionsPage(); });

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

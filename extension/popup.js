// The toolbar popup: whether the extension can reach the Job Pilotto app, and "Read the jobs on this page" (visit.js) for a job list the app
// cannot read by itself. The application panel and the fill start only on a tab the desktop app opened (Apply).
import {api, settings} from './flow.js';

const $ = id => document.getElementById(id);
$('settings').addEventListener('click', event => { event.preventDefault(); chrome.runtime.openOptionsPage(); });
const LINKEDIN = 'LinkedIn forbids reading its pages with an extension and may restrict accounts that do. Reading page by page with pauses keeps that small, not zero.';

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
    } else {
      $('status').textContent = app ? 'The Job Pilotto app isn\'t open: the panel still shows what\'s left' : 'Your Worker isn\'t reachable';
    }
  }
  // "Read the jobs on this page": only on a web page, only on the person's click (the click also gives the access: activeTab).
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!app || !tab?.id || !/^https?:/.test(tab.url || '')) return;
  $('visit').hidden = false;
  const host = new URL(tab.url).hostname;
  if (/(^|\.)linkedin\.com$/.test(host)) $('visit-note').textContent = LINKEDIN;
  const show = state => {
    if (!state) return;
    $('visit-progress').textContent = state.stopped
      ? `${state.jobs} jobs read from ${state.name || host} on ${state.pages} page${state.pages === 1 ? '' : 's'}: stopped, ${state.stopped}.`
      : `Reading ${state.name || host}: page ${state.pages}, ${state.jobs} jobs so far…`;
  };
  show((await chrome.storage.session.get(`visit:${tab.id}`))[`visit:${tab.id}`]);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes[`visit:${tab.id}`]) show(changes[`visit:${tab.id}`].newValue); });
  $('visit-read').addEventListener('click', async () => {
    $('visit-read').disabled = true;
    // Access to this one site, asked once, so the reading goes on as the list moves to its next pages (Chrome asks you).
    const origin = `${new URL(tab.url).origin}/*`;
    const allowed = await chrome.permissions.request({origins: [origin]}).catch(() => false);
    $('visit-progress').textContent = allowed ? 'Reading…' : 'Reading this page only (no access to its next pages)…';
    chrome.runtime.sendMessage({type: 'visitRead', tabId: tab.id}, state => {
      $('visit-read').disabled = false;
      if (!state?.ok) $('visit-progress').textContent = `Not read: ${state?.error || 'the app did not answer'}.`;
    });
  });
})();

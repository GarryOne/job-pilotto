// The toolbar popup: whether the extension can reach the Job Pilotto app and, on a tab the app opened and manages, what fits that tab (Apply on this page,
// Allow, Stop). On any other tab it only says where things happen: no control at all (popup-controls.js, owner 16 Oct 2026).
import {api, settings} from './flow.js';
import {popupMode} from './tab-pages.js';
import {POPUP_CONTROLS, judgedUrl, popupControls} from './popup-controls.js';

const $ = id => document.getElementById(id);
$('settings').addEventListener('click', event => { event.preventDefault(); chrome.runtime.openOptionsPage(); });
const show = (ids) => { for (const id of POPUP_CONTROLS) $(id).hidden = !ids.includes(id); };   // the one place a control appears

// Stop: one press halts the extension everywhere (stop.js). Wired first, shown on a managed tab before the connection check, so a slow check never hides it.
$('stop').addEventListener('click', () => {
  $('stop').disabled = true;
  chrome.runtime.sendMessage({type: 'stop', reason: 'the Stop button in the toolbar popup'}, answer => {
    $('stop-note').className = 'stopped';
    $('stop-note').textContent = answer?.ok ? 'Stopped. Nothing runs until you press Apply in the app.' : 'Could not reach the extension: turn it off in chrome://extensions.';
  });
});

async function connection(config, app) {
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
}

const allowButton = (done) => $('visit-allow').addEventListener('click', async () => {
  const ok = await chrome.permissions.request({origins: ['https://*/*']}).catch(() => false);
  $('visit-progress').textContent = ok ? done : 'Not allowed: the extension can\'t work on this site.';
});

(async () => {
  const config = await settings();
  const app = !config.workerUrl || config.workerUrl.startsWith('http://127.0.0.1');
  const checked = connection(config, app);
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!app || !tab?.id) return checked;
  const kept = await chrome.storage.session.get([`armed:${tab.id}`, `readmark:${tab.id}`]).catch(() => ({}));
  const mode = popupMode({url: judgedUrl(tab.url, kept[`readmark:${tab.id}`]), armed: kept[`armed:${tab.id}`]});
  // A tab the app opened to apply: the panel on the page fills the form.
  if (mode === 'fill') {
    // Not allowed on this site yet: the panel can't start, so the popup says so and offers the Allow (site-allow.js), never "the panel fills the form".
    if (!(await chrome.permissions.contains({origins: [`${new URL(tab.url).origin}/*`]}).catch(() => true))) {
      $('intro').textContent = 'The Job Pilotto app opened this page to apply, but the extension isn\'t allowed on this site yet. Allow it, once, on the sites the app opens for you:';
      $('visit').hidden = false;
      show(popupControls(mode, {allowed: false}));
      allowButton('Allowed: the form is being filled.');
      return checked;
    }
    $('intro').textContent = 'The Job Pilotto app opened this page to apply: the panel on the page fills the form and tells you what is left.';
    // Always there on a tab the app opened (owner, 9 Oct 2026: after a refresh nothing started and there was no way to start it): run the fill again, here.
    show(popupControls(mode));
    $('apply-here').addEventListener('click', () => {
      $('apply-here').disabled = true;
      $('apply-progress').textContent = 'Starting…';
      chrome.runtime.sendMessage({type: 'applyHere', tabId: tab.id}, answer => { $('apply-progress').textContent = answer?.ok ? 'Started: the panel on the page shows the steps.' : (answer?.why || 'Could not start here.'); $('apply-here').disabled = false; });
    });
    return checked;
  }
  if (mode !== 'read') return checked;   // the person's own tab: only the line that says where things happen
  // A tab the app opened to read its jobs: it reads by itself (visit.js), so nothing to press but Stop; only what it does.
  $('visit').hidden = false;
  const host = new URL(tab.url).hostname;
  const allowed = await chrome.permissions.contains({origins: ['https://*/*']}).catch(() => true);
  show(popupControls(mode, {allowed}));
  // Waiting for the one-time permission (Chrome asks; withdraw it any time in Chrome's settings).
  if (!allowed) {
    $('visit-text').textContent = 'The Job Pilotto app opened this site to read its jobs. Allow the extension, once, to read the sites the app opens for you:';
    allowButton('Allowed: reading starts on the tabs the app opened.');
  } else {
    $('visit-text').textContent = 'The Job Pilotto app opened this page and the extension is reading it by itself.';
  }
  const progress = state => {
    if (!state) return;
    $('visit-progress').textContent = state.stopped
      ? `${state.filters?.length ? `Filters: ${state.filters.join(', ')}. ` : ''}${state.note ? `${state.note}. ` : ''}${state.jobs} jobs read from ${state.name || host} on ${state.pages} page${state.pages === 1 ? '' : 's'}: stopped, ${state.stopped}.`
      : `Reading ${state.name || host}: page ${state.pages}, ${state.jobs} jobs so far…`;
  };
  progress((await chrome.storage.session.get(`visit:${tab.id}`))[`visit:${tab.id}`]);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes[`visit:${tab.id}`]) progress(changes[`visit:${tab.id}`].newValue); });
  return checked;
})();

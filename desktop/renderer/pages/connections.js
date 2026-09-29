// Settings → connections: Apply with Claude, the extension, how often, Always on.
import {shared} from './shared.js';
import {$, message, osText, show} from './core.js';
import {saveDailyTarget} from './focus.js';
import {loadSettings} from './profile.js';
import {refreshServices, renderOverview, showRunMode} from './settings.js';
import {toastMessage} from './startup.js';
import {goStep} from './wizard.js';

// ---------- Apply with Claude: what only the user can install (wizard, Optional extras) ----------
async function showClaudePrereqs() {
  const found = await window.pilot.claudePrereqs().catch(() => null);
  if (!found) return;
  const link = (href, text) => Object.assign(document.createElement('a'), {href, target: '_blank', textContent: text});
  const items = [
    [found.claude, 'Claude Code installed', link('https://claude.com/claude-code', 'Install Claude Code')],
    [found.signedIn, 'Signed in to Claude Code with your Claude account', document.createTextNode(
      found.windows ? 'Open PowerShell, run claude, then /login' : 'Open Terminal, run claude, then /login')],
    ...(found.windows ? [[found.git, 'Git for Windows installed (Claude Code needs it)', link('https://git-scm.com/downloads/win', 'Install Git for Windows')]] : []),
    [null, 'Claude in Chrome extension added and signed in', link('https://chromewebstore.google.com/search/Claude', 'Get it from the Chrome Web Store')],
    // Built into the app (nothing to install): sessions run inside Job Pilotto; without it, in Terminal windows.
    [found.inApp, found.inApp ? 'In-app terminal ready (built in): sessions run inside Job Pilotto' : 'In-app terminal unavailable',
      document.createTextNode('sessions open in Terminal windows instead')],
  ];
  $('claude-prereqs').replaceChildren(...items.map(([done, text, action]) => {
    const li = document.createElement('li');
    li.className = done ? 'done' : '';
    li.append(`${done ? '✓' : done === false ? '○' : '•'} ${text}`);
    if (!done) li.append(' · ', action);
    return li;
  }));
}

// ---------- Chrome extension: connected? (it checks in every 30 s) ----------
export async function showExtensionStatus() {
  const seen = await window.pilot.extensionSeen();
  const on = seen && Date.now() - seen.at < 90 * 1000;
  $('ext-status').textContent = on ? `✓ Installed and connected${seen.version ? ` (version ${seen.version})` : ''}.`
    : 'Not connected: install it below, or open Chrome if it\'s installed (it checks in within 30 seconds).';
  $('ext-status').className = `status-line ${on ? 'on' : ''}`;
  $('ext-setup').open = !on;
}

// ---------- how often each job runs ----------
const SCHEDULE_DEFAULTS = {search: 4, kits: 0, insights: 'daily', scout: 'daily', mail: 3};
export function showSchedule() {
  const schedule = {...SCHEDULE_DEFAULTS, ...(shared.state.settings.schedule || {})};
  document.querySelectorAll('[data-schedule]').forEach(select => { select.value = String(schedule[select.dataset.schedule]); });
}
// Automation: the schedules, the daily target and reminders are saved together with Save changes (enabled once
// something changed); with Always on, the GitHub repo is updated to the new schedule too.
// Automation saves each change at once (no Save button). A small toast says what was saved; with Always on, the GitHub
// repository is brought up to date once, a moment after the last change (several changes → one update).
const REPO_DELAY = 1500;
let repoTimer = null;
let lastToast = null;
function savedToast(title, body = '') {
  lastToast?.remove();
  const toast = lastToast = toastMessage(title, body);
  setTimeout(() => toast.remove(), 3000);
}
const saveState = text => { $('automation-state').textContent = text || 'Changes save automatically'; };
function updateRepo() {
  if (!shared.state.settings.cloud?.repo) return;
  clearTimeout(repoTimer);
  repoTimer = setTimeout(async () => {
    saveState(`Updating ${shared.state.settings.cloud.repo}…`);
    const result = await window.pilot.cloudConnect();
    saveState('');
    if (result.ok) savedToast('GitHub updated ✓', `${result.repo} follows the new settings.`);
    else toastMessage('GitHub not updated', `${result.error} Your change is saved on this Mac; change a setting again to retry.`);
  }, REPO_DELAY);
}
async function saveSchedule(select) {
  const schedule = {...SCHEDULE_DEFAULTS, ...(shared.state.settings.schedule || {})};
  schedule[select.dataset.schedule] = /^\d+$/.test(select.value) ? Number(select.value) : select.value;
  await window.pilot.saveSettings({schedule});
  shared.state = await window.pilot.state();
  const task = select.closest('.task-row')?.querySelector('b')?.textContent || 'Schedule';
  savedToast('Saved ✓', `${task}: ${select.selectedOptions[0]?.textContent}`);
  updateRepo();
}
async function saveReminders() {
  await window.pilot.saveSettings({focusReminders: $('set-remind').checked});
  $('focus-remind').checked = $('set-remind').checked;
  shared.state = await window.pilot.state();
  savedToast('Saved ✓', `Focus reminders ${$('set-remind').checked ? 'on' : 'off'}`);
}
// The target lives in Notion's ⚙️ Search settings: written only when it really changed (it's a slow round trip).
async function saveTarget() {
  const input = $('set-target');
  if (!input.value || input.value === input.dataset.saved) return;
  saveState('Saving the daily target to Notion…');
  const ok = await saveDailyTarget(input);
  saveState('');
  if (!ok) { input.value = input.dataset.saved || ''; return; }
  input.dataset.saved = input.value;
  savedToast('Saved ✓', `Daily application target: ${input.value}`);
  updateRepo();
}

// ---------- Always on: runs in the user's private GitHub repo, even with the Mac off ----------
export function showCloud() {
  const cloud = shared.state.settings.cloud;
  showRunMode();
  $('cloud-status').textContent = cloud?.repo
    ? osText(`✓ On: running from ${cloud.repo} on the schedule above, even with the Mac off.`) : 'Off: jobs run on this Mac while the app is open.';
  $('cloud-connect').textContent = cloud?.repo ? 'Update' : 'Turn on';
  $('cloud-open').hidden = $('cloud-off').hidden = !cloud?.repo;
  $('auto-search').disabled = !!cloud?.repo;
  showTelegramCloud();
}

// "Connected to …", or, when the setup found a repository from an earlier setup, which one and since when.
function connectedTo(result) {
  if (!result.existing) return `Connected to ${result.repo}`;
  const since = new Date(result.existing.createdAt).toLocaleDateString([], {day: 'numeric', month: 'short', year: 'numeric'});
  return `Using your existing private repository ${result.repo} (created ${since})`;
}

// Telegram buttons, always on (the user's own Cloudflare Worker; lib/telegram-cloud.js).
function showTelegramCloud() {
  const on = shared.state.settings.telegramCloud;
  show($('tg-cloud'), !!shared.state.settings.cloud?.repo);
  $('tg-cloud-status').textContent = on ? osText(`✓ On: your bot answers from Cloudflare, even with the Mac off (${on.url.replace('https://', '')}).`)
    : 'Off: your bot answers buttons and commands only while this app is open.';
  show($('tg-cloud-howto'), !on);
  show($('tg-cloud-token'), !on);
  $('tg-cloud-on').textContent = on ? 'Update' : 'Turn on';
  show($('tg-cloud-off'), !!on);
  refreshServices();  // Settings → Connections: the GitHub and Cloudflare cards move between Available and Connected
}
let cloudUrls = null;
let cloudWaiting = false;
let cloudSince = 0;

export async function showGoogle() {
  const google = await window.pilot.googleStatus().catch(() => ({connected: false}));
  $('google-status').textContent = google.connected ? `✓ Connected as ${google.email}` : google.error ? 'Sign-in expired: connect again' : 'Not connected';
  $('google-status').classList.toggle('on', !!google.connected);
  $('google-connect').textContent = google.connected ? 'Reconnect' : 'Connect Google';
}
function alertLine(name, text) { const line = document.querySelector(`[data-secret="${name}"]`); line.textContent = text; line.classList.remove('on'); }

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('claude-prereqs-check').addEventListener('click', showClaudePrereqs);
  showClaudePrereqs();
  setInterval(() => {
    if (document.querySelector('.view[data-view="settings"]').hidden) return;
    showExtensionStatus();
    if (!document.querySelector('[data-settings-page="overview"]').hidden) renderOverview().catch(() => {});
  }, 10000);
  document.querySelectorAll('[data-schedule]').forEach(select => select.addEventListener('change', () => saveSchedule(select)));
  $('set-remind').addEventListener('change', saveReminders);
  $('set-target').addEventListener('change', saveTarget);
  $('tg-cloud-on').addEventListener('click', async () => {
    $('tg-cloud-on').disabled = true;
    message('tg-cloud-message', 'Setting up your bot helper on Cloudflare…');
    const result = await window.pilot.telegramCloudOn($('tg-cloud-token').value);
    $('tg-cloud-on').disabled = false;
    if (result.ok) { $('tg-cloud-token').value = ''; shared.state = await window.pilot.state(); showTelegramCloud(); }
    message('tg-cloud-message', result.ok ? 'Done ✓ Try a button in Telegram.' : result.error, result.ok ? 'ok' : 'error');
  });
  $('tg-cloud-off').addEventListener('click', async () => {
    await window.pilot.telegramCloudOff();
    shared.state = await window.pilot.state(); showTelegramCloud();
    message('tg-cloud-message', 'Off: the app answers your bot again while it\'s open.', 'ok');
  });
  $('cloud-connect').addEventListener('click', async () => {
    if (!shared.state.secrets.ANTHROPIC_API_KEY || !shared.state.secrets.NOTION_TOKEN) {
      message('cloud-message', 'Add your AI key and connect Notion first: the searches in GitHub use them.', 'error'); return;
    }
    $('cloud-connect').disabled = true;
    if (!cloudWaiting) message('cloud-message', 'Opening GitHub sign-in…');
    const result = await window.pilot.cloudConnect();
    $('cloud-connect').disabled = false;
    if (result.needsRepo) {
      // Signed in, not installed yet: open GitHub's install page (its repository picker) and wait for the install.
      cloudUrls = result;
      show($('cloud-steps'));
      if (!cloudWaiting) { window.pilot.openExternal(result.installUrl); cloudSince = Date.now(); }
      message('cloud-message', 'Signed in to GitHub ✓ Now pick the repository on GitHub. Waiting for the install…', 'waiting');
      cloudWaiting = true;
      if (Date.now() - cloudSince < 10 * 60 * 1000) setTimeout(() => $('cloud-connect').click(), 5000);
      else { cloudWaiting = false; message('cloud-message', 'Still not installed. Install Job Pilotto on a repository on GitHub, then press Turn on again.', 'error'); }
      return;
    }
    cloudWaiting = false;
    if (result.needsChoice) {
      show($('cloud-steps'), false);
      $('cloud-repo').replaceChildren(...result.repos.map(name => Object.assign(document.createElement('option'), {value: name, textContent: name})));
      show($('cloud-choose'));
      message('cloud-message', 'Job Pilotto is installed on several repositories: choose the one to use.', '');
      return;
    }
    if (!result.ok) { message('cloud-message', result.error, 'error'); return; }
    show($('cloud-steps'), false);
    shared.state = await window.pilot.state();
    showCloud();
    message('cloud-message', `${connectedTo(result)} ✓ ` +
      `${result.secrets.length} keys stored as encrypted secrets. The first run follows your schedule; press Search now to start one right away.`, 'ok');
  });
  window.pilot.onCloudStep(step => {
    if (step.code) {
      // The sign-in code, big and bold, with Copy: it's what the user has to find and type on github.com.
      const box = $('cloud-message');
      box.className = 'message';
      const code = Object.assign(document.createElement('b'), {className: 'device-code', textContent: step.code});
      const copy = Object.assign(document.createElement('button'), {className: 'link', textContent: 'Copy'});
      copy.addEventListener('click', () => { navigator.clipboard.writeText(step.code); copy.textContent = 'Copied ✓'; });
      box.replaceChildren('In the browser tab that opened, enter this code and approve Job Pilotto:', document.createElement('br'),
        code, ' ', copy, document.createElement('br'), Object.assign(document.createElement('span'), {className: 'muted small', textContent: step.url}));
    }
    else message('cloud-message', step.text);
  });
  $('cloud-use').addEventListener('click', async () => {
    $('cloud-use').disabled = true;
    const result = await window.pilot.cloudConnect($('cloud-repo').value);
    $('cloud-use').disabled = false;
    if (!result.ok) { message('cloud-message', result.error, 'error'); return; }
    show($('cloud-choose'), false);
    shared.state = await window.pilot.state();
    showCloud();
    message('cloud-message', `${connectedTo(result)} ✓ ${result.secrets.length} keys stored as encrypted secrets.`, 'ok');
  });
  $('cloud-create').addEventListener('click', () => window.pilot.openExternal(cloudUrls.createUrl));
  $('cloud-install').addEventListener('click', () => window.pilot.openExternal(cloudUrls.installUrl));
  $('cloud-open').addEventListener('click', () => window.pilot.openExternal(`https://github.com/${shared.state.settings.cloud.repo}`));
  $('cloud-off').addEventListener('click', async () => {
    await window.pilot.cloudOff();
    shared.state = await window.pilot.state();
    showCloud();
    message('cloud-message', 'Off. The app searches while it is open. Your GitHub repository is still there: delete it on GitHub, or turn this on again later.');
  });
  window.pilot.onTelegramWaiting(username => {
    message('telegram-message', `Now open t.me/${username} in Telegram and press Start (waiting up to 2 minutes)…`);
    window.pilot.openExternal(`https://t.me/${username}`);
  });
  $('auto-search').addEventListener('change', () => window.pilot.setAutomation({autoSearch: $('auto-search').checked}));
  $('open-login').addEventListener('change', () => window.pilot.setAutomation({openAtLogin: $('open-login').checked}));
  $('google-connect').addEventListener('click', async () => {
    $('google-connect').disabled = true;
    message('google-message', 'Finish the sign-in in your browser (Google may call the app unverified: Advanced → Go to Job Pilotto).');
    const result = await window.pilot.googleConnect();
    $('google-connect').disabled = false;
    message('google-message', result.ok ? 'Connected ✓' : result.error, result.ok ? 'ok' : 'error');
    showGoogle();
  });
  $('set-notion-oauth').addEventListener('click', async () => {
    $('set-notion-oauth').disabled = true;
    message('set-notion-message', 'Waiting for Notion: approve in your browser, then come back here…', 'waiting');
    const result = await window.pilot.notionOAuth();
    $('set-notion-oauth').disabled = false;
    message('set-notion-message', result.ok ? 'Reconnected ✓' : result.error || 'Not connected.', result.ok ? 'ok' : 'error');
    if (result.ok) { shared.state = await window.pilot.state(); loadSettings(); }
  });
  $('set-notion-save').addEventListener('click', async () => {
    const value = $('set-notion').value.trim();
    if (!value) return;
    const result = await window.pilot.notionConnect(value);
    if (!result.ok) { alertLine('NOTION_TOKEN', result.error || `Not found: ${(result.missing || []).join(', ') || 'columns missing'}`); return; }
    $('set-notion').value = '';
    loadSettings();
  });
  for (const [id, name, check] of [['anthropic', 'ANTHROPIC_API_KEY', true], ['serpapi', 'SERPAPI_API_KEY', false]]) {
    $(`set-${id}-save`).addEventListener('click', async () => {
      const value = $(`set-${id}`).value.trim();
      if (!value) return;
      const checked = check ? await window.pilot.checkAnthropic(value) : {ok: true};
      if (!checked.ok) { alertLine(name, checked.error || 'That key was rejected'); return; }
      try {
        await window.pilot.saveSecret(name, value);
      } catch (error) {
        alertLine(name, error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
        return;
      }
      $(`set-${id}`).value = '';
      loadSettings();
    });
  }
  $('open-extension-folder').addEventListener('click', () => window.pilot.showFolder('extension'));
  $('open-data').addEventListener('click', () => window.pilot.showFolder('data'));
  $('rerun-wizard').addEventListener('click', () => { show($('app'), false); show($('wizard')); goStep('welcome'); });
}

// Settings → connections: Apply with Claude, the extension, how often, Always on.
import {shared} from './shared.js';
import {$, message, osPick, osText, show} from './core.js';
import {moreButton, pill} from '../components.js';
import {icon} from '../icons.js';
import {saveDailyTarget} from './focus.js';
import {loadSettings} from './profile.js';
import {extensionState} from '../service-status.js';
import {noteCheck, openSetting, refreshServices, renderOverview, showRunMode, stateLine} from './settings.js';
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
    [found.chrome, found.chrome ? 'Claude in Chrome extension added (sign in to it in Chrome once)' : 'Claude in Chrome extension added and signed in',
      link('https://chromewebstore.google.com/search/Claude', 'Get it from the Chrome Web Store')],
    // Built into the app (nothing to install): sessions run inside Job Pilotto; without it, in Terminal windows.
    [found.inApp, found.inApp ? 'In-app terminal ready (built in): sessions run inside Job Pilotto' : 'In-app terminal unavailable',
      document.createTextNode('sessions open in Terminal windows instead')],
  ];
  $('claude-prereqs').replaceChildren(...items.map(([done, text, action]) => {
    const li = document.createElement('li');
    li.className = done ? 'done' : '';
    const words = document.createElement('span');
    words.append(text);
    if (!done) words.append(' · ', action);
    li.append(icon(done ? 'check-circle' : 'info'), words);
    return li;
  }));
}

// A windowless Chrome from an earlier automation holds macOS's one Apple Event connection to Chrome, so the app
// cannot reach the user's window with its scripting (focus, reload). Nothing owns it any more, so it can be quit.
function showStray(entry) {
  const box = $('ext-stray');
  show(box, !!entry);
  if (!entry) return;
  $('ext-stray-text').textContent = `A windowless Chrome from an earlier automation (started ${entry.since}) holds Chrome's scripting connection, so this app can't reach your own Chrome window.`;
  $('ext-stray-quit').dataset.pid = String(entry.pid);
}

// ---------- Chrome extension: is it installed (the browser says so at once), and is it awake (its report)? ----------
// What the card says in each state: the pill is the state, this is the sentence that explains it.
const EXT_LINE = {
  connected: 'Connected: it fills application forms with your details and CV.',
  closed: 'Installed in Chrome. Chrome isn\'t running, so it can\'t reach this app: open it and it reports within 30 seconds.',
  idle: 'Installed in Chrome but not connected to this app yet. Press Connect the extension, then Connect to the Job Pilotto app.',
  off: 'Installed in Chrome but turned off: switch it back on in chrome://extensions.',
  absent: 'Not installed in Chrome yet — the three steps below take a minute.',
  checking: 'Looking for it in Chrome…',
};
export async function showExtensionStatus() {
  const [seen, found] = await Promise.all([window.pilot.extensionSeen().catch(() => null), window.pilot.extensionInstall().catch(() => null)]);
  const state = extensionState({known: !!found || !!seen, installed: found?.installed || [], seen, browserRunning: found?.browserUp ?? null});
  const pill = stateLine(state.on, state.on && state.version ? `v${state.version}` : '', state.checking, state.words);
  pill.id = 'ext-status';
  $('ext-status').replaceWith(pill);
  if (state.checking) { setTimeout(showExtensionStatus, 1500); return; }  // only until the first profile read lands
  $('ext-line').textContent = EXT_LINE[state.state] || EXT_LINE.absent;
  showStray((await window.pilot.strayChrome().catch(() => []))[0] || null);
  $('ext-path').textContent = found?.folder || '';  // what Chrome's Load unpacked dialog wants pasted
  show($('ext-connect'), state.state === 'idle');
  $('ext-setup').open = state.state !== 'connected';
  const SUMMARY = {connected: 'Reinstall or troubleshoot', absent: 'Install the extension'};
  $('ext-setup').querySelector('summary').textContent = SUMMARY[state.state] || 'Troubleshoot the connection';
  noteCheck({extension: {installed: found?.installed || [], seen, browserUp: found?.browserUp ?? null}});  // the cards above follow
}

// ---------- how often each job runs ----------
const SCHEDULE_DEFAULTS = {search: 4, kits: 0, insights: 'daily', scout: 'daily', mail: 3};
export function showSchedule() {
  const schedule = {...SCHEDULE_DEFAULTS, ...(shared.state.settings.schedule || {})};
  document.querySelectorAll('[data-schedule]').forEach(select => { select.value = String(schedule[select.dataset.schedule]); });
  showScheduleState();
}
// Each task's state beside its frequency: On (where it runs, when next), Off, On demand, or what it's missing.
export function showScheduleState(next = shared.nextRuns || {}) {
  const value = kind => document.querySelector(`[data-schedule="${kind}"]`)?.value;
  const where = shared.state?.settings?.cloud?.repo ? 'GitHub' : 'this Mac, while open';
  let google = null;
  try { google = JSON.parse(localStorage.getItem('serviceChecks') || 'null')?.google?.connected ?? null; } catch {}
  const when = at => {
    if (!at) return '';
    const date = new Date(at), today = new Date();
    const day = date.toDateString() === today.toDateString() ? 'Today'
      : date.toDateString() === new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toDateString() ? 'Tomorrow'
        : date.toLocaleDateString([], {weekday: 'short'});
    return `${day} ${date.toTimeString().slice(0, 5)}`;
  };
  const state = {
    search: value('search') === '0' ? ['Off'] : ['On', where, when(next.search)],
    kits: value('kits') === '0' ? ['On demand'] : ['On', 'after each search'],
    scout: value('scout') === 'off' ? ['Off'] : ['On', where, when(next.scout)],
    insights: value('insights') === 'off' ? ['Off'] : ['On', 'every morning'],
    mail: value('mail') === '0' ? ['Off'] : google === false ? ['Connect Google', '', '', 'warn'] : ['On', where, when(next.mail)],
  };
  document.querySelectorAll('[data-schedule-state]').forEach(node => {
    const [label, place, at, tone] = state[node.dataset.scheduleState] || ['Off'];
    node.className = `task-state${tone === 'warn' ? ' is-warn' : label === 'On' ? ' is-on' : ''}`;
    const detail = [place, at].filter(Boolean).join(' · ');
    node.replaceChildren(label, ...(detail ? [Object.assign(document.createElement('small'), {textContent: ` · ${detail}`})] : []));
  });
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
    ? osText(`${cloud.repo} · runs the schedule above, even with the Mac off`) : 'Jobs run on this Mac while the app is open.';
  $('cloud-connect').textContent = cloud?.repo ? 'Update' : 'Turn on';
  $('cloud-open').hidden = $('cloud-more').hidden = !cloud?.repo;
  $('cloud-more').replaceChildren(...(cloud?.repo ? [moreButton([{label: 'Turn off Always on', danger: true, run: () => $('cloud-off').click()}])] : []));
  showCloudPill();
  $('auto-search').disabled = !!cloud?.repo;
  showTelegramCloud();
}
function showCloudPill() {
  const on = !!shared.state.settings.cloud?.repo;
  $('cloud-pill').replaceChildren(cloudWaiting && !on ? pill('Setting up', 'info', {dot: true}) : on ? pill('On', 'good', {dot: true}) : pill('Off', 'neutral'));
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
  $('tg-cloud-status').textContent = on ? osText(`${on.url.replace('https://', '')} · your bot answers from Cloudflare, even with the Mac off`)
    : 'Your bot answers buttons and commands only while this app is open.';
  $('tg-cloud-pill').replaceChildren(on ? pill('On', 'good', {dot: true}) : pill('Off', 'neutral'));
  // Off: "Set up" opens the steps and the token field (Turn on sits beside the field). On: Update in the row, Turn off in ⋯.
  show($('tg-cloud-setup'), !on);
  if (on) show($('tg-cloud-form'), false);
  if (on) $('tg-cloud-actions').prepend($('tg-cloud-on')); else $('tg-cloud-form').querySelector('.inline').append($('tg-cloud-on'));
  $('tg-cloud-on').textContent = on ? 'Update' : 'Turn on';
  show($('tg-cloud-more'), !!on);
  $('tg-cloud-more').replaceChildren(...(on ? [moreButton([{label: 'Turn off Telegram buttons', danger: true, run: () => $('tg-cloud-off').click()}])] : []));
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
  noteCheck({google: {connected: !!google.connected, email: google.email || ''}});  // the cards above follow
}
function alertLine(name, text) { const line = document.querySelector(`[data-secret="${name}"]`); line.textContent = text; line.classList.remove('on'); line.classList.add('is-plain'); }

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  // No "Check again": the checklist refreshes by itself when you come back to the window (e.g. after installing
  // Claude Code or the Chrome extension), while the extras step is open.
  window.addEventListener('focus', () => { if (!document.querySelector('.step[data-step="extras"]')?.hidden) showClaudePrereqs(); });
  showClaudePrereqs();
  setInterval(() => {
    if (document.querySelector('.view[data-view="settings"]').hidden) return;
    showExtensionStatus();
    if (!document.querySelector('[data-settings-page="overview"]').hidden) renderOverview().catch(() => {});
  }, 10000);
  // The run mode is a choice, not a signpost. "Always on" (when it is off) opens the card that sets it up;
  // "While app is open" (when Always on is on) turns it off, after saying what that changes — before this, either
  // click only scrolled to the Always on card, so the mode could not be switched from here at all (1 Oct 2026).
  document.querySelectorAll('[data-run-mode]').forEach(button => button.addEventListener('click', async () => {
    const on = !!shared.state.settings.cloud?.repo;
    const wantCloud = button.dataset.runMode === 'cloud';
    if (wantCloud === on) return;                      // already that mode: nothing to do
    if (wantCloud) { openSetting('cloud'); return; }   // setting it up is the Always on card's job
    const result = await window.pilot.cloudTurnOffConfirmed().catch(() => null);
    if (!result?.ok) return;
    shared.state = await window.pilot.state();
    showRunMode();
    showCloud();
    savedToast('Runs while the app is open', 'Always on is off. Your GitHub repository stays there.');
  }));
  $('run-mode-more').addEventListener('click', () => openSetting('cloud'));
  document.querySelectorAll('[data-schedule]').forEach(select => select.addEventListener('change', () => { saveSchedule(select); showScheduleState(); }));
  $('set-remind').addEventListener('change', saveReminders);
  $('set-target').addEventListener('change', saveTarget);
  $('tg-cloud-setup').addEventListener('click', () => {
    const form = $('tg-cloud-form');
    show(form, form.hidden);
    if (!form.hidden) $('tg-cloud-token').focus();
  });
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
      message('cloud-message', shared.state.secrets.NOTION_TOKEN ? 'Always on runs on GitHub and needs an API key (Settings → Connections → AI), even when this Mac uses Claude Code.'
        : 'Add an API key and connect Notion first: the searches in GitHub use them.', 'error'); return;
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
      showCloudPill();
      if (Date.now() - cloudSince < 10 * 60 * 1000) setTimeout(() => $('cloud-connect').click(), 5000);
      else { cloudWaiting = false; showCloudPill(); message('cloud-message', 'Still not installed. Install Job Pilotto on a repository on GitHub, then press Turn on again.', 'error'); }
      return;
    }
    cloudWaiting = false;
    showCloudPill();
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
  $('ext-stray-quit').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const result = await window.pilot.quitStrayChrome(Number(button.dataset.pid)).catch(() => null);
    button.disabled = false;
    toastMessage(result?.ok ? 'Background Chrome quit' : 'Couldn\'t quit it',
      result?.ok ? 'Chrome\'s scripting now reaches your window — press the button again.' : (result?.error || 'Try again.'));
    showExtensionStatus();
  });
  // The step-1 chip: best effort at Chrome's page, and the URL on the clipboard so the paste always gets there.
  $('ext-open-page').addEventListener('click', async () => {
    const result = await window.pilot.extensionPage().catch(() => null);
    message('ext-message', result?.opened
      ? osText('Chrome should be opening its extensions page. If it doesn\'t: chrome://extensions is on your clipboard (⌘L, ⌘V, ⏎).')
      : osText('chrome://extensions is on your clipboard: in Chrome press ⌘L, then ⌘V and ⏎.'), result?.opened ? 'ok' : 'error');
  });
  // The folder in front of the user and its path on the clipboard. The Mac's dialog takes ⌘⇧G (Go to Folder), ⌘V,
  // Return; the PC's has no such shortcut, so it gets its own sentence. Bound by attribute, so the setup wizard's
  // own button behaves the same.
  for (const button of document.querySelectorAll('[data-show-extension-folder]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const result = await window.pilot.extensionShow().catch(() => null);
      button.disabled = false;
      toastMessage(result?.opened ? 'Extension folder opened' : 'Couldn\'t open the folder',
        result?.opened ? osPick('Its path is on your clipboard: in Chrome press Load unpacked, then ⌘⇧G, ⌘V, Return.',
          'Its path is on your clipboard: in Chrome press Load unpacked, paste it into the folder box (Ctrl+V), and press Enter.')
          : 'Open the extension folder by hand, then press Load unpacked in Chrome.');
    });
  }
  $('ext-connect').addEventListener('click', async () => {
    const result = await window.pilot.extensionOptions().catch(() => null);
    message('ext-message', result?.opened ? 'Its settings page is open: press Connect to the Job Pilotto app there.'
      : 'Couldn\'t open the extension\'s settings page. Open it from Chrome: 🧩 → ⋮ next to Job Pilotto → Options.', result?.opened ? 'ok' : 'error');
  });
  $('open-data').addEventListener('click', () => window.pilot.showFolder('data'));
  $('rerun-wizard').addEventListener('click', () => { show($('app'), false); show($('wizard')); goStep('welcome'); });
  $('ov-review-setup').addEventListener('click', () => $('rerun-wizard').click());  // the same, from Settings → Overview
}

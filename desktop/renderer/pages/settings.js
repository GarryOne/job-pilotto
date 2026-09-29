// Settings: its sub-pages.
import {el, tile} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {openView, remembered} from './nav.js';
import {profileTab, showContact} from './profile.js';

// ---------- Settings: sub-pages (Overview, Application profile, Automation, Connections, Data & backup, Advanced) ----------
export function settingsPage(name) {
  remembered('settingsPage', name);
  if (name === 'profile') openProfile();
  document.querySelectorAll('[data-settings-page]').forEach(page => show(page, page.dataset.settingsPage === name));
  // The menu: Profile is a Settings page of its own there.
  document.querySelectorAll('.nav[data-view="settings"]').forEach(nav => nav.classList.toggle('active', (nav.dataset.settings === 'profile') === (name === 'profile')));
  document.querySelectorAll('.settings-nav [data-settings-go]').forEach(button => button.classList.toggle('is-active', button.dataset.settingsGo === name));
}
// One Settings card (setting-<id>): its sub-page, then scrolled to. Used by every link into Settings.
export function openSetting(id) {
  const card = $(`setting-${id}`);
  if (!card) return;
  const view = card.closest('.view')?.dataset.view;
  if (view && view !== 'settings') {  // a card on another page (Profile: CV, details, links, assistant)
    openView(view);
    setTimeout(() => card.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
    return;
  }
  settingsPage(card.closest('[data-settings-page]')?.dataset.settingsPage || 'overview');
  if (card.classList.contains('conn-panel')) document.querySelectorAll('.conn-panel').forEach(panel => show(panel, panel === card));
  setTimeout(() => card.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
}
// Settings → Profile: CV & details and Standard answers. What goes into applications; nothing here re-scores jobs.
async function openProfile() {
  shared.state = await window.pilot.state();
  $('contact-save').disabled = true;
  $('claude-consent').checked = !!shared.state.settings.claudeConsent;
  showContact();
  profileTab('details');
}

// Connections status, shared by Overview (cards + alert), Connections (Connected / Available + alert) and the
// dot on Connections. required: counted for the alert and the dot (Google Jobs is an optional extra).
const SERVICES = [
  {id: 'ai', name: 'Anthropic', icon: 'bot', what: 'AI for scoring and application kits', required: true,
    why: 'Reading jobs, fit scores and application kits need your AI key.'},
  {id: 'notion', name: 'Notion', icon: 'layers', what: 'Job search workspace', required: true,
    why: 'Your jobs, applications and profile live in your Notion.'},
  {id: 'google', name: 'Gmail & Calendar', icon: 'mail', what: 'Read-only access', required: true,
    why: 'Replies, interviews and recruiter emails are tracked from Gmail.'},
  {id: 'extension', name: 'Chrome extension', icon: 'puzzle', what: 'Application form filling', required: true,
    why: 'It fills application forms with your details and CV.'},
  {id: 'telegram', name: 'Telegram', icon: 'send', what: 'Digests and reminders', required: true,
    why: 'Daily digests and reminders need a bot connection.'},
  {id: 'serpapi', name: 'Google Jobs (SerpApi)', icon: 'search', what: 'Additional job results', connect: 'Add key'},
];
async function serviceStatus() {
  const [google, seen] = await Promise.all([window.pilot.googleStatus().catch(() => ({})), window.pilot.extensionSeen().catch(() => null)]);
  const extensionOn = !!seen && Date.now() - seen.at < 90 * 1000;
  const on = {ai: !!shared.state.secrets.ANTHROPIC_API_KEY, notion: !!shared.state.secrets.NOTION_TOKEN, serpapi: !!shared.state.secrets.SERPAPI_API_KEY,
    telegram: !!(shared.state.secrets.TELEGRAM_BOT_TOKEN && shared.state.settings.telegramChatId), google: !!google.connected, extension: extensionOn};
  const detail = {google: google.connected && google.email, extension: extensionOn && seen.version && `v${seen.version}`,
    telegram: on.telegram && shared.state.settings.telegramBot && `@${shared.state.settings.telegramBot}`};
  return {on, detail, missing: SERVICES.find(service => service.required && !on[service.id]) || null};
}
function stateLine(on, detail = '') {
  const line = el('span', `service-state${on ? ' is-on' : ''}`);
  line.append(icon(on ? 'check' : 'info'), on ? `Connected${detail ? ` · ${detail}` : ''}` : 'Not connected');
  return line;
}
function showAlert(prefix, missing) {
  show($(`${prefix}-alert`), !!missing);
  if (!missing) return;
  $(`${prefix}-alert-title`).textContent = prefix === 'ov' ? `Finish connecting ${missing.name}` : `${missing.name} is not connected`;
  $(`${prefix}-alert-text`).textContent = missing.why;
  $(`${prefix}-alert-go`).textContent = prefix === 'ov' ? `Connect ${missing.name}` : `Set up ${missing.name}`;
  $(`${prefix}-alert-go`).onclick = () => openSetting(missing.id);
}
async function renderConnections(status) {
  const {on, detail, missing} = status || await serviceStatus();
  show($('connections-dot'), !!missing);
  showAlert('conn', missing);
  const card = service => {
    const box = el('div', 'service-card is-row');
    const text = el('span', 'service-text');
    text.append(el('b', '', service.name), stateLine(on[service.id], detail[service.id]), el('span', 'muted small', service.what));
    const button = el('button', on[service.id] ? 'secondary' : 'secondary is-signal', on[service.id] ? 'Manage' : service.connect || 'Connect');
    button.addEventListener('click', () => openSetting(service.id));
    box.append(tile(service.icon, on[service.id] ? 'good' : 'warn'), text, button);
    return box;
  };
  $('conn-on').replaceChildren(...SERVICES.filter(service => on[service.id]).map(card));
  $('conn-off').replaceChildren(...SERVICES.filter(service => !on[service.id]).map(card));
  show($('conn-off-head'), SERVICES.some(service => !on[service.id]));
}
export async function renderOverview() {
  const [status, backup, contact] = await Promise.all([serviceStatus(), window.pilot.backupStatus().catch(() => ({})),
    window.pilot.contact().catch(() => ({}))]);
  const {on, detail, missing} = status;
  renderConnections(status);
  renderDiagnostics(status);
  showAlert('ov', missing);
  $('ov-services').replaceChildren(...SERVICES.filter(service => service.required).map(service => {
    const card = Object.assign(document.createElement('button'), {type: 'button', className: 'service-card', title: `Open ${service.name}`});
    const text = el('span');
    text.append(el('b', '', service.name), stateLine(on[service.id], detail[service.id]));
    card.append(tile(service.icon, on[service.id] ? 'good' : 'warn'), text);
    card.addEventListener('click', () => openSetting(service.id));
    return card;
  }));
  $('ov-cv').textContent = shared.state.settings.cvName || 'None yet';
  const needed = {first_name: 'first name', last_name: 'last name', email: 'email', phone: 'phone'};
  const gaps = Object.keys(needed).filter(key => !contact?.[key]).map(key => needed[key]);
  const line = el('span', `service-state${gaps.length ? '' : ' is-on'}`);
  line.append(icon(gaps.length ? 'info' : 'check'), gaps.length ? `Missing: ${gaps.join(', ')}` : 'Complete');
  $('ov-contact').replaceChildren(line);
  const chosen = kind => document.querySelector(`[data-schedule="${kind}"]`)?.selectedOptions[0]?.textContent || '';
  $('ov-search').textContent = chosen('search');
  $('ov-kits').textContent = chosen('kits');
  $('ov-cloud').textContent = shared.state.settings.cloud?.repo ? `On — GitHub ${shared.state.settings.cloud.repo}` : 'Off — runs while the app is open';
  $('ov-backup').textContent = backup.at ? new Date(backup.at).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : 'None yet';
}
// Automation: run mode (this Mac while open, or Always on in GitHub); both segments lead to the Always on card.
export function showRunMode() {
  const repo = shared.state.settings.cloud?.repo;
  document.querySelectorAll('[data-run-mode]').forEach(button => button.classList.toggle('is-active', (button.dataset.runMode === 'cloud') === !!repo));
  $('run-mode-text').textContent = repo ? `Runs in your GitHub repository ${repo}, even with your Mac off.`
    : 'Scheduled tasks run on this Mac while Job Pilotto is open.';
  $('run-mode-more').textContent = repo ? 'Manage Always on' : 'Learn about Always on';
  $('tz-note').textContent = `Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
}
function renderDiagnostics({on, detail}) {
  const version = document.querySelector('[data-version]')?.textContent?.trim();
  $('diag-app').replaceChildren(stateLine(true, version));
  $('diag-app').firstChild.lastChild.textContent = `Running${version ? ` · ${version}` : ''}`;
  $('diag-ext').replaceChildren(stateLine(on.extension, detail.extension));
  $('diag-search').textContent = $('last-search').textContent;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  document.addEventListener('click', event => {
    const go = event.target.closest('[data-settings-go]');
    if (go) { settingsPage(go.dataset.settingsGo); document.querySelector('main')?.scrollTo(0, 0); }
  });
  $('ov-backups').addEventListener('click', () => window.pilot.showBackups());
  $('ov-profile').addEventListener('click', () => settingsPage('profile'));

  // Application profile: CV preview, one Save for contact + links (enabled once something changed), the assistant's explainer.
  document.querySelectorAll('[data-contact]').forEach(input => input.addEventListener('input', () => { $('contact-save').disabled = false; }));
  $('claude-how').addEventListener('click', () => { $('claude-how-text').hidden = !$('claude-how-text').hidden; });
  document.querySelectorAll('[data-run-mode]').forEach(button => button.addEventListener('click', () => openSetting('cloud')));
  $('run-mode-more').addEventListener('click', () => openSetting('cloud'));
  // Data & backup and Advanced: explainers and the reset options open on demand; Diagnostics shows live status.
  $('reports-how').addEventListener('click', () => { $('reports-how-text').hidden = !$('reports-how-text').hidden; });
  $('reset-review').addEventListener('click', () => { $('reset-options').hidden = !$('reset-options').hidden; });
  $('diag-troubleshoot').addEventListener('click', () => {
    settingsPage('connections');
    const help = document.querySelector('[data-settings-page="connections"] .troubleshoot');
    help.open = true;
    setTimeout(() => help.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
  });
}

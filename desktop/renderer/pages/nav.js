// Navigation: pages, ⌘R memory, the ⌘K palette.
import {openPalette} from '../palette.js';
import {COMMAND_KIND, KIND, TASK_BUTTONS, kindOf, lastActivity, openActivity, prepareActions, unqueue} from './activity.js';
import {$, show} from './core.js';
import {shared} from './shared.js';
import {showCvChanged} from './cv-change.js';
import {loadFocus} from './focus.js';
import {showFocusStarted} from './focus-onboarding.js';
import {loadCalendar} from './calendar.js';
import {loadInterviews} from './interviews.js';
import {openJobPanel} from './job-panel.js';
import {applyViewGate} from './notion-connect.js';
import {loadSettings} from './profile.js';
import {openSession, renderSessionPage} from './session-log.js';
import {bestSession, renderDock, sessionList} from './sessions.js';
import {settingsPage, showServicesNow} from './settings.js';
import {loadStrategy} from './strategy.js';
import * as viewHistory from '../view-history.js';

// ---------- app ----------
// The page (and Settings section) open now, kept for a reload (⌘R): the app comes back where it was.
// sessionStorage: survives a reload of this window, not a restart of the app (that opens Focus as before).
export const remembered = (key, value) => {
  try { if (value === undefined) return sessionStorage.getItem(key); sessionStorage.setItem(key, value); } catch {}
  return null;
};
// Back / forward (⌘← ⌘→, ⌘[ ⌘], the mouse's side buttons): every screen opened through here, in order, and the
// Recent activity panel opened over one (pages/activity.js tells us through panelOpened / panelClosed).
let history = viewHistory.start(null);
export const panelOpened = run => { history = viewHistory.openPanel(history, run); };
export const panelClosed = run => { history = viewHistory.closePanel(history, run); };
// A page with unsaved work can hold a move away (Strategy's draft): guard(proceed) returns true to let it go, or false and calls proceed() later.
const leaveGuards = {};
let currentView = '';
export const guardLeave = (view, guard) => { leaveGuards[view] = guard; };
export function openView(name, {fromHistory = false} = {}) {
  const leaving = currentView;
  if (leaving && leaving !== name && leaveGuards[leaving] && !leaveGuards[leaving](() => { currentView = ''; openView(name, {fromHistory}); })) return;
  currentView = name;
  if (!fromHistory) history = viewHistory.visit(history, name);
  remembered('view', name);
  window.pilot.pageView?.(name).catch?.(() => {});   // the page's name only (a fixed list on the other side), for the usage funnel
  setTimeout(() => { if (typeof renderDock === 'function' && sessionList) renderDock(); }, 0);  // the tray hides on the sessions page
  if (name === 'actions') prepareActions();   // its banner and result card are in the first frame, not a moment later above the tasks (#286)
  document.querySelectorAll('.view').forEach(view => show(view, view.dataset.view === name));
  document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === name));
  // Notion later: a page that needs Notion shows only its gate card until it is connected (pages/notion-connect.js); connecting reopens it.
  // Focus without Notion shows its Get started list instead (pages/focus.js showFocusStarted): a fresh setup can search first.
  const started = name === 'focus' && showFocusStarted();
  const locked = !started && applyViewGate(name, {then: () => openView(name, {fromHistory: true})});
  if (name === 'sessions' && !locked) renderSessionPage();  // the view's HTML starts on the spinner; opening it must paint the list we already have
  if (name === 'strategy') { loadStrategy(); showCvChanged(); }
  if (name === 'settings') {
    settingsPage('overview');
    showServicesNow();
    loadSettings();
    window.pilot.dailyTarget().then(setting => { $('set-target').value = $('set-target').dataset.saved = setting.target; $('set-remind').checked = setting.reminders; });
  }
  if (name === 'interviews' && !locked) loadInterviews();
  if (name === 'calendar' && !locked) loadCalendar();
  if (name === 'focus' && !locked && !started) loadFocus();
}

// ⌘K / Ctrl+K: the command palette. Its commands are the app's own buttons, read when it opens (so a disabled
// button or a missing Notion link isn't offered); running one opens its page, then clicks it.
const PALETTE_KEYWORDS = {mail: 'email inbox replies confirmations calendar google', run: 'search check jobs find refresh scan crawl',
  tailor: 'tailor cv resume top matches', visits: 'linkedin indeed glassdoor sites read portals visit extension',
  scout: 'employers companies discover', status: 'health check', weekly: 'report stats weekly insight review', insight: 'tip advice', kits: 'kits prepare applications cover letter', tune: 'strategy settings roles places tune',
  today: 'telegram list', applied: 'applications', saved: 'bookmarks starred'};
// A button's own words: the count badge and the dot inside a nav button are not part of its label.
export const labelOf = node => {
  if (!node) return '';
  const copy = node.cloneNode(true);
  copy.querySelectorAll('.nav-badge, .nav-dot').forEach(child => child.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
};
function paletteCommands() {
  const commands = [];
  const add = (group, label, hint, keywords, run) => { if (label) commands.push({group, label, hint, keywords, run}); };
  // A button that starts a task an Actions card already offers is that card's twin: one entry per task (6 Oct 2026: "Refresh jobs" and
  // "Check for new jobs" were listed side by side and ran the same jobs check).
  const carded = new Set([...document.querySelectorAll('.action[data-command]')].map(node => COMMAND_KIND[node.dataset.command]).filter(Boolean));
  const twins = new Set(TASK_BUTTONS.filter(([kind]) => carded.has(kind)).flatMap(([, ...selectors]) => selectors.map(s => document.querySelector(s))).filter(Boolean));
  const button = (view, id, keywords, hint = '') => {
    const node = $(id);
    if (node && !twins.has(node) && !node.disabled && !node.closest('[hidden]:not(.view)')) add(view[0].toUpperCase() + view.slice(1), labelOf(node), hint || node.title, keywords, () => { openView(view); node.click(); });
  };
  document.querySelectorAll('.nav').forEach(nav => add('Go to', `Open ${labelOf(nav)}`, '', 'page view', () => nav.click()));
  // The bottom bar's panel is not a page, so the loop above misses it (owner, 7 Oct 2026: "recent" found nothing).
  add('Go to', 'Open Recent activity', 'Every task run: its result, its log, and Stop for the one running', 'recent activity history runs tasks log results running',
    () => openActivity(true));
  document.querySelectorAll('.action[data-command]').forEach(node => add('Actions', labelOf(node.querySelector('b')).replace(/^\W+/, ''),
    labelOf(node.querySelector('span')), PALETTE_KEYWORDS[node.dataset.command], () => { openView('actions'); node.click(); }));
  // An action card with its own handler (not a Telegram command): "Tailor CVs" costs minutes of AI, so the palette opens its card and focuses the count; Run stays a click.
  document.querySelectorAll('.action[data-palette]').forEach(node => add('Actions', labelOf(node.querySelector('b')).replace(/^\W+/, ''),
    labelOf(node.closest('.task-body')?.querySelector('.task-words .muted')), PALETTE_KEYWORDS[node.dataset.palette], () => { openView('actions'); if (node.dataset.palette !== 'tailor') { node.click(); return; } const count = $('tailor-top-n'); count.focus(); count.select(); }));
  // A task waiting its turn can be taken out of the queue from here too (activity.js unqueue).
  (lastActivity?.queued || []).forEach(run => add('Actions', `Remove ${KIND[kindOf(run)].name} from the queue`, 'It has not started: it will not run',
    'unqueue cancel queued waiting remove', () => unqueue(run)));
  // Every tracked job's page (pages/job-panel.js): its kit, prep, reviews, record, messages and history, found by its title or company.
  (shared.allJobs || []).filter(job => job.stage && job.url).forEach(job => add('Jobs', `Open job page: ${job.title} · ${job.company}`, job.stage,
    'job page kit cover letter form answers prep review record messages description history', () => { openView('jobs'); openJobPanel(job); }));
  // Jobs → List | Board and every saved view chip (pages/jobs-views.js), read from the page so a new view is listed by itself.
  document.querySelectorAll('[data-mode]').forEach(node => add('Jobs', `Show jobs as a ${labelOf(node).toLowerCase()}`, node.dataset.mode === 'board'
    ? 'Your applications in columns by stage; drag a card to change its stage' : 'One row per job', 'pipeline kanban board columns stages list', () => { openView('jobs'); node.click(); }));
  document.querySelectorAll('#jobs-views [data-view]').forEach(node => add('Jobs', `Jobs view: ${labelOf(node.firstChild)}`, node.title,
    'saved view filter applications active rejected this week', () => { openView('jobs'); if (node.getAttribute('aria-pressed') !== 'true') node.click(); }));
  button('jobs', 'refresh', 'find jobs scan');
  button('strategy', 'open-profile', 'edit roles locations places cities country skills targeting preferences');
  button('jobs', 'apply-open', 'apply fill forms');
  button('jobs', 'applied-open', 'track add application outside');
  button('jobs', 'import-open', 'add job link paste posting');
  button('jobs', 'lead-open', 'log activity recruiter message email screenshot');
  button('interviews', 'iv-add', 'upload audio video transcript file');
  button('interviews', 'iv-record', 'start call audio', 'Record a call (everyone agreed)');
  button('interviews', 'iv-recordings', 'files folder finder');
  // Settings: every page, every section (by its heading) and every button in a section, read from the page itself so a new one is listed without being
  // added here (6 Oct 2026: Export and Import data were not in ⌘K). A section opens its page and scrolls to it; a button does that and presses it,
  // except in the danger zone, where it is only focused: the person presses it.
  const pages = new Set();   // one entry a page: Overview's shortcuts ("Manage automation") lead to a page already listed
  document.querySelectorAll('[data-settings-go]').forEach(go => {
    if (pages.has(go.dataset.settingsGo)) return;
    pages.add(go.dataset.settingsGo);
    add('Settings', `Open Settings: ${labelOf(go)}`, '', 'settings preferences', () => { openView('settings'); go.click(); });
  });
  // Connections are drawn as service cards (settings.js renderConnections): each one's Manage or Connect.
  document.querySelectorAll('#conn-on .service-card, #conn-off .service-card').forEach(card => {
    const name = labelOf(card.querySelector('.service-text b')), node = card.querySelector('button');
    if (name && node) add('Settings', `${name}: ${labelOf(node)}`, labelOf(card.querySelector('.service-text .muted')), 'settings connections connect', () => { openView('settings'); settingsPage('connections'); node.click(); });
  });
  const shown = node => !node.closest('[hidden]:not(.view):not([data-settings-page])');
  const seen = new Set();
  document.querySelectorAll('[data-settings-page] .setting[id]').forEach(section => {
    const title = labelOf(section.querySelector('h3') || section.querySelector('h4, summary'));   // a summary's own heading, not its whole line
    if (!shown(section) || !title || seen.has(title)) return;
    seen.add(title);
    const page = section.closest('[data-settings-page]').dataset.settingsPage;
    const open = () => {
      openView('settings'); settingsPage(page);
      if (section.tagName === 'DETAILS') section.open = true;
      section.scrollIntoView({block: 'start'});
    };
    add('Settings', title, '', `settings ${page}`, open);
    section.querySelectorAll('button[id]').forEach(node => {
      if (node.disabled || !shown(node) || twins.has(node)) return;
      const danger = !!node.closest('.danger-zone') || /danger/.test(node.className);
      add('Settings', `${title}: ${labelOf(node)}`, node.title, `settings ${page}`, () => { open(); if (danger) node.focus(); else node.click(); });
    });
  });
  document.querySelectorAll('#notion-links:not([hidden]) .notion-link').forEach(link => add('Notion', `Notion: ${labelOf(link)}`, '', 'open page database', () => link.click()));
  return commands;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
function go(way) {
  if (!$('activity-panel').hidden) history = viewHistory.withRun(history, shared.selectedRun);   // forward to it again shows the same run
  const step = way === 'back' ? viewHistory.back(history) : viewHistory.forward(history);
  if (!step.name) return;
  const [from, to] = [viewHistory.step(history.list[history.at]), viewHistory.step(step.name)];
  history = step.history;
  if (to.view !== from.view || !to.panel) openView(to.view, {fromHistory: true});   // the panel's own step: the screen under it is already there
  if (to.panel) shared.selectedRun = to.run;
  openActivity(to.panel, {fromHistory: true});
}
const editable = target => !!target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm');

export async function init() {
  const mac = /Mac/.test(navigator.platform);
  document.addEventListener('keydown', event => {
    const way = viewHistory.navKey(event, {mac, editable: editable(event.target)});
    if (way) { event.preventDefault(); go(way); }
  });
  document.addEventListener('mouseup', event => {  // the mouse's side buttons: 3 back, 4 forward
    if (event.button === 3 || event.button === 4) { event.preventDefault(); go(event.button === 3 ? 'back' : 'forward'); }
  });
  document.querySelectorAll('.nav').forEach(nav => {
    nav.title = nav.textContent.trim();  // the label, when the narrow window shows the sidebar as icons only
    nav.addEventListener('click', () => {
      // A button of the menu that is not a page ("Send feedback" opens its own dialog; the wizard's "Stuck? Tell us"): it has no view to open.
      // Opening "no view" hid every page and left the window blank behind the dialog (a friend's first feedback, 2 Oct 2026).
      if (!nav.dataset.view) return;
      // Applying opens the session that needs you most (else the latest), not just the page.
      if (nav.dataset.view === 'sessions' && bestSession()) return openSession(bestSession().id);
      openView(nav.dataset.view);
      if (nav.dataset.settings) settingsPage(nav.dataset.settings);
    });
  });
  // The sessions line at the foot does the same as Applying.
  $('nav-sessions').addEventListener('click', () => document.querySelector('.nav[data-view="sessions"]').click());
  $('palette-hint').addEventListener('click', () => openPalette(paletteCommands()));
  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if ($('app').hidden) return;  // the setup wizard has nothing to run yet
    event.preventDefault();
    // Open or closed, not present or absent: a closed palette is removed a moment later (its close event), and ⌘K pressed in between did nothing (Linux/Windows CI, 6 Oct 2026).
    if ($('palette')?.open) $('palette').close(); else openPalette(paletteCommands());
  });
}

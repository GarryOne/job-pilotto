// Navigation: pages, ⌘R memory, the ⌘K palette.
import {openPalette} from '../palette.js';
import {$, show} from './core.js';
import {showCvChanged} from './cv-change.js';
import {loadFocus} from './focus.js';
import {loadCalendar} from './calendar.js';
import {loadInterviews} from './interviews.js';
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
// Back / forward (⌘← ⌘→, ⌘[ ⌘], the mouse's side buttons): every screen opened through here, in order.
let history = viewHistory.start(null);
export function openView(name, {fromHistory = false} = {}) {
  if (!fromHistory) history = viewHistory.visit(history, name);
  remembered('view', name);
  window.pilot.pageView?.(name).catch?.(() => {});   // the page's name only (a fixed list on the other side), for the usage funnel
  setTimeout(() => { if (typeof renderDock === 'function' && sessionList) renderDock(); }, 0);  // the tray hides on the sessions page
  document.querySelectorAll('.view').forEach(view => show(view, view.dataset.view === name));
  document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === name));
  // Notion later: a page that needs Notion shows only its gate card until it is connected (pages/notion-connect.js); connecting reopens it.
  const locked = applyViewGate(name, {then: () => openView(name, {fromHistory: true})});
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
  if (name === 'focus' && !locked) loadFocus();
}

// ⌘K / Ctrl+K: the command palette. Its commands are the app's own buttons, read when it opens (so a disabled
// button or a missing Notion link isn't offered); running one opens its page, then clicks it.
const PALETTE_KEYWORDS = {mail: 'email inbox replies confirmations calendar google', run: 'search jobs find refresh',
  tailor: 'tailor cv resume top matches',
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
  const button = (view, id, keywords, hint = '') => {
    const node = $(id);
    if (node && !node.disabled && !node.closest('[hidden]:not(.view)')) add(view[0].toUpperCase() + view.slice(1), labelOf(node), hint || node.title, keywords, () => { openView(view); node.click(); });
  };
  document.querySelectorAll('.nav').forEach(nav => add('Go to', `Open ${labelOf(nav)}`, '', 'page view', () => nav.click()));
  document.querySelectorAll('.action[data-command]').forEach(node => add('Actions', labelOf(node.querySelector('b')).replace(/^\W+/, ''),
    labelOf(node.querySelector('span')), PALETTE_KEYWORDS[node.dataset.command], () => { openView('actions'); node.click(); }));
  // An action card with its own handler (not a Telegram command): "Tailor CVs" costs minutes of AI, so the palette opens its card and focuses the count; Run stays a click.
  document.querySelectorAll('.action[data-palette]').forEach(node => add('Actions', labelOf(node.querySelector('b')).replace(/^\W+/, ''),
    labelOf(node.closest('.task-body')?.querySelector('.task-words .muted')), PALETTE_KEYWORDS[node.dataset.palette], () => { openView('actions'); if (node.dataset.palette !== 'tailor') { node.click(); return; } const count = $('tailor-top-n'); count.focus(); count.select(); }));
  button('jobs', 'refresh', 'find jobs scan');
  button('jobs', 'apply-open', 'apply fill forms');
  button('jobs', 'applied-open', 'track add application outside');
  button('jobs', 'import-open', 'add job link paste posting');
  button('jobs', 'lead-open', 'log activity recruiter message email screenshot');
  button('interviews', 'iv-add', 'upload audio video transcript file');
  button('interviews', 'iv-record', 'start call audio', 'Record a call (everyone agreed)');
  button('interviews', 'iv-recordings', 'files folder finder');
  document.querySelectorAll('#notion-links:not([hidden]) .notion-link').forEach(link => add('Notion', `Notion: ${labelOf(link)}`, '', 'open page database', () => link.click()));
  return commands;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
function go(way) {
  const step = way === 'back' ? viewHistory.back(history) : viewHistory.forward(history);
  if (!step.name) return;
  history = step.history;
  openView(step.name, {fromHistory: true});
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
    if ($('palette')) $('palette').close(); else openPalette(paletteCommands());
  });
}

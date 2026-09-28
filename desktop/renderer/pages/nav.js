// Navigation: pages, ⌘R memory, the ⌘K palette.
import {openPalette} from '../palette.js';
import {$, show} from './core.js';
import {showCvChanged} from './cv-change.js';
import {loadFocus} from './focus.js';
import {loadInterviews} from './interviews.js';
import {loadSettings} from './profile.js';
import {renderDock, sessionList} from './sessions.js';
import {settingsPage} from './settings.js';
import {loadStrategy} from './strategy.js';

// ---------- app ----------
// The page (and Settings section) open now, kept for a reload (⌘R): the app comes back where it was.
// sessionStorage: survives a reload of this window, not a restart of the app (that opens Focus as before).
export const remembered = (key, value) => {
  try { if (value === undefined) return sessionStorage.getItem(key); sessionStorage.setItem(key, value); } catch {}
  return null;
};
export function openView(name) {
  remembered('view', name);
  setTimeout(() => { if (typeof renderDock === 'function' && sessionList) renderDock(); }, 0);  // the tray hides on the sessions page
  document.querySelectorAll('.view').forEach(view => show(view, view.dataset.view === name));
  document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === name));
  if (name === 'strategy') { loadStrategy(); showCvChanged(); }
  if (name === 'settings') {
    settingsPage('overview');
    $('automation-save').disabled = true;
    loadSettings();
    window.pilot.dailyTarget().then(setting => { $('set-target').value = setting.target; $('set-remind').checked = setting.reminders; });
  }
  if (name === 'interviews') loadInterviews();
  if (name === 'focus') loadFocus();
}

// ⌘K / Ctrl+K: the command palette. Its commands are the app's own buttons, read when it opens (so a disabled
// button or a missing Notion link isn't offered); running one opens its page, then clicks it.
const PALETTE_KEYWORDS = {mail: 'email inbox replies confirmations calendar google', run: 'search jobs find refresh',
  scout: 'employers companies discover', status: 'health check', weekly: 'report stats', insight: 'tip advice',
  today: 'telegram list', applied: 'applications', saved: 'bookmarks starred'};
const labelOf = node => node?.textContent.replace(/\s+/g, ' ').trim() || '';
function paletteCommands() {
  const commands = [];
  const add = (group, label, hint, keywords, run) => { if (label) commands.push({group, label, hint, keywords, run}); };
  const button = (view, id, keywords, hint = '') => {
    const node = $(id);
    if (node && !node.disabled && !node.closest('[hidden]:not(.view)')) add(view[0].toUpperCase() + view.slice(1), labelOf(node), hint || node.title, keywords, () => { openView(view); node.click(); });
  };
  document.querySelectorAll('.nav').forEach(nav => add('Go to', `Open ${labelOf(nav)}`, '', 'page view', () => openView(nav.dataset.view)));
  document.querySelectorAll('.action[data-command]').forEach(node => add('Actions', labelOf(node.querySelector('b')).replace(/^\W+/, ''),
    labelOf(node.querySelector('span')), PALETTE_KEYWORDS[node.dataset.command], () => { openView('actions'); node.click(); }));
  button('jobs', 'refresh', 'find jobs scan');
  button('jobs', 'apply-open', 'apply fill forms');
  button('jobs', 'applied-open', 'track add application outside');
  button('interviews', 'iv-add', 'upload audio video transcript file');
  button('interviews', 'iv-record', 'start call audio', 'Record a call (everyone agreed)');
  button('interviews', 'iv-recordings', 'files folder finder');
  document.querySelectorAll('#notion-links:not([hidden]) .notion-link').forEach(link => add('Notion', `Notion: ${labelOf(link)}`, '', 'open page database', () => link.click()));
  return commands;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  document.querySelectorAll('.nav').forEach(nav => {
    nav.title = nav.textContent.trim();  // the label, when the narrow window shows the sidebar as icons only
    nav.addEventListener('click', () => openView(nav.dataset.view));
  });
  $('palette-hint').addEventListener('click', () => openPalette(paletteCommands()));
  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if ($('app').hidden) return;  // the setup wizard has nothing to run yet
    event.preventDefault();
    if ($('palette')) $('palette').close(); else openPalette(paletteCommands());
  });
}

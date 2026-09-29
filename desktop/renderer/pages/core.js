// Shared helpers and start-up state of the window.
import {fillIcons} from '../icons.js';
import {ago} from '../jobs-view.js';
import {localize, osText as swap} from '../os.js';
import {shared} from './shared.js';

export const $ = id => document.getElementById(id);
export const osText = text => swap(text, window.pilot.platform);
export const STEPS = ['welcome', 'ai', 'notion', 'cv', 'draft', 'extras'];
// How old a saved screen is, in minutes (ago() rounds to hours): "just now", "4 min ago", "2 h ago".
export const savedAgo = iso => {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  return !Number.isFinite(minutes) || minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} h ago` : ago(iso);
};

// "Today 19:10", "Mon 19:10", or a date once it is older than a week.
export function runWhen(iso) {
  const at = new Date(iso), today = new Date();
  const time = at.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  if (at.toDateString() === today.toDateString()) return `Today ${time}`;
  if (today - at > 7 * 86400000) return `${at.toLocaleDateString([], {day: 'numeric', month: 'short'})} ${time}`;
  return `${at.toLocaleDateString([], {weekday: 'short'})} ${time}`;
}

// ---------- helpers ----------
export function show(element, visible = true) { element.hidden = !visible; }
export function message(id, text, tone = '') { const el = $(id); el.textContent = text || ''; el.className = `message ${tone}`; }
function chip(parent, text) { const span = document.createElement('span'); span.className = 'chip'; span.textContent = text; parent.append(span); }
// Regex fragments from the draft ("z[uü]rich", "\\bsre\\b") shown as plain words.
export const readable = fragment => fragment.replace(/\\b/g, '').replace(/\[([^\]])[^\]]*\]/g, '$1').replace(/[.?*+()]/g, '').trim();

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  localize(document.body, window.pilot.platform);
  fillIcons();
  for (const line of document.querySelectorAll('[data-version]')) line.textContent = `Version ${shared.state.about.label}`;
  for (const line of document.querySelectorAll('[data-version-title]')) line.title = `Version ${shared.state.about.label}`;

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-link]');
    if (link) { event.preventDefault(); window.pilot.openExternal(link.dataset.link); }
    const copy = event.target.closest('[data-copy]');
    if (copy) navigator.clipboard.writeText($(copy.dataset.copy).textContent).then(() => { copy.textContent = 'Copied ✓'; });
  });
}

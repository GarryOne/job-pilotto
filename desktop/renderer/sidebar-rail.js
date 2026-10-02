// The sidebar as an icon rail: automatically in a narrow window (under 1180 px, where there is no room for labels), or when the person
// collapsed it with the button at the foot of the menu (remembered in this window's localStorage). .app.rail carries the layout (style.css).
import {icon} from './icons.js';

export const NARROW = 1180;
const KEY = 'sidebarCollapsed';
// Is the menu a rail now? A narrow window always shows one; a wide one follows the person's choice.
export const railed = (width, collapsed) => width < NARROW || !!collapsed;
// The button only makes sense where there is room to expand again.
export const toggleShown = width => width >= NARROW;

const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const write = value => { try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* the choice just isn't remembered */ } };

export function init() {
  const app = document.getElementById('app'), button = document.getElementById('rail-toggle');
  if (!app) return;
  let collapsed = read();
  const paint = () => {
    const width = window.innerWidth;
    app.classList.toggle('rail', railed(width, collapsed));
    if (!button) return;
    button.hidden = !toggleShown(width);
    const label = collapsed ? 'Expand menu' : 'Collapse menu';
    button.title = label;
    button.setAttribute('aria-pressed', String(collapsed));
    button.querySelector('svg')?.replaceWith(icon(collapsed ? 'expand' : 'collapse'));
    const text = document.getElementById('rail-toggle-label');
    if (text) text.textContent = label;
  };
  button?.addEventListener('click', () => { collapsed = !collapsed; write(collapsed); paint(); });
  window.addEventListener('resize', paint);
  paint();
}

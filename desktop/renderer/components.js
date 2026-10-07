// Job Pilotto's UI building blocks (styles in components.css, values in tokens.css). Screens build their
// pills, tags, tiles and ⋯ menus with these, so the same thing looks and behaves the same everywhere;
// gallery.html shows every one of them side by side.
import {icon} from './icons.js';
import {GATE_FOOTNOTE, GATE_TITLE, NOTION_BENEFITS} from './notion-benefits.js';

// el(tag, class, content): content is text, or a node (an icon, another element) that is appended, never
// turned into "[object SVGSVGElement]".
export const el = (tag, className, content) => {
  const node = Object.assign(document.createElement(tag), className ? {className} : {});
  if (content instanceof Node) node.append(content); else if (content != null) node.textContent = content;
  return node;
};

// Pill: a short status. Tones: neutral, info, good, warn, bad, signal, teal. dot: a coloured dot before it.
export const TONES = ['neutral', 'info', 'good', 'warn', 'bad', 'signal', 'teal'];
export function pill(text, tone = 'neutral', {dot = false, title = ''} = {}) {
  const node = el('span', `ui-pill tone-${tone}${dot ? ' dot' : ''}`, text);
  if (title) node.title = title;
  return node;
}

// Tag: a label (a skill, a topic). With onClick it's a button, in the accent colour (📝 Kit, 📄 Tailored CV).
export function tag(text, {title = '', onClick = null, busy = false} = {}) {
  const node = el(onClick ? 'button' : 'span', `ui-tag${onClick ? ' is-action' : ''}${busy ? ' is-busy' : ''}`, text);
  if (title) node.title = title;
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

// Tile: an icon on a soft square of its tone (a recording, a schedule slot).
export function tile(glyph, tone = 'signal') {
  const node = el('span', `ui-tile tone-${tone}`);
  node.append(icon(glyph));
  return node;
}

// Choice cards: one of a few options side by side (radio cards), each an icon tile, a bold title, a short description
// and a check badge on the chosen one. choices: [{id, icon, title, text, disabled?, note?}]; selected: an id or null
// (nothing chosen yet); onPick(id) when one is clicked.
export function choiceCards(choices, {selected = null, onPick = () => {}, label = ''} = {}) {
  const group = el('div', 'ui-choices');
  group.setAttribute('role', 'radiogroup');
  if (label) group.setAttribute('aria-label', label);
  for (const choice of choices) {
    const card = el('button', `ui-choice${choice.id === selected ? ' is-selected' : ''}${choice.disabled ? ' is-disabled' : ''}`);
    Object.assign(card, {type: 'button', disabled: !!choice.disabled});
    card.dataset.choice = choice.id;
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(choice.id === selected));
    const text = el('span', 'ui-choice-text');
    text.append(el('b', '', choice.title), el('span', 'muted small', choice.text));
    if (choice.note) text.append(el('span', 'ui-choice-note small', choice.note));
    const check = el('span', 'ui-choice-check');
    check.append(icon('tick'));
    card.append(tile(choice.icon, choice.id === selected ? 'signal' : 'neutral'), text, check);
    card.addEventListener('click', () => onPick(choice.id));
    group.append(card);
  }
  return group;
}

// ⋯ menu: one floating list for the whole window, closed by Esc, a click outside, scrolling or picking an item.
// Items: {label, run(event), title?, danger?, icon?} (icon: a name from icons.js) or '-' for a divider.
const menu = el('div', 'ui-menu');
menu.hidden = true;
menu.setAttribute('role', 'menu');
document.body.append(menu);
let menuAnchor = null;   // the ⋯ button the open menu belongs to
let menuAt = null;   // where that button was when the menu opened: a scroll that did not move it leaves the menu open
// within: close it only when its ⋯ button is inside that element. A list that redraws passes its own page, so a background redraw of Jobs
// does not close a menu open on Focus (6 Oct 2026: the e2e "I'm out: withdraw" click found no menu, closed by a Jobs read finishing).
export function closeMenu(within = null) {
  if (within && !(menuAnchor && within.contains(menuAnchor))) return;
  menu.hidden = true;
  menuAnchor = null;
  menuAt = null;
  for (const open of document.querySelectorAll('.ui-more[aria-expanded="true"]')) open.setAttribute('aria-expanded', 'false');
}
export function openMenu(anchor, items) {
  const wasOpen = anchor.getAttribute('aria-expanded') === 'true';
  closeMenu();
  if (wasOpen) return;
  menu.replaceChildren(...items.map(item => {
    if (item === '-') return document.createElement('hr');
    const button = el('button', `${item.danger ? 'danger' : ''}${item.icon ? ' with-menu-icon' : ''}`.trim(), item.icon ? icon(item.icon) : null);
    if (item.icon) button.append(item.label); else button.textContent = item.label;
    button.title = item.title || '';
    button.disabled = !!item.disabled;
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', event => { closeMenu(); item.run(event); });
    return button;
  }));
  menu.hidden = false;
  anchor.setAttribute('aria-expanded', 'true'); menuAnchor = anchor;
  const box = anchor.getBoundingClientRect();
  menuAt = {top: box.top, left: box.left};
  const below = box.bottom + 6 + menu.offsetHeight <= window.innerHeight;
  menu.style.top = `${Math.max(8, below ? box.bottom + 6 : box.top - menu.offsetHeight - 6)}px`;
  menu.style.left = `${Math.max(8, box.right - menu.offsetWidth)}px`;
  menu.querySelector('button')?.focus();
}
document.addEventListener('click', event => { if (!menu.hidden && !event.target.closest('.ui-menu, .ui-more')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
// A scroll closes the menu only when it moved its ⋯ button (or the button left the page). Scroll events arrive a frame late: the scroll that brings a
// button into view before a click (Playwright's, a keyboard focus) landed after the menu had opened and shut it at once (7 Oct 2026, the Windows
// focusdismiss suite: "waiting for getByRole('menuitem', { name: 'Dismiss interview' })" for 30 s).
export function scrollCloses(anchor, at) {
  if (!anchor?.isConnected || !at) return true;
  const box = anchor.getBoundingClientRect();
  return Math.abs(box.top - at.top) > 1 || Math.abs(box.left - at.left) > 1;
}
document.addEventListener('scroll', () => { if (!menu.hidden && scrollCloses(menuAnchor, menuAt)) closeMenu(); }, true);   // not `closeMenu` itself: the Event would be taken as `within` and throw (#307)

// The ⋯ button that opens a menu. items: an array, or a function returning one (built when opened).
export function moreButton(items, title = 'More actions') {
  const button = el('button', 'secondary ui-more');
  button.title = title;
  button.setAttribute('aria-label', 'More actions');
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.append(icon('more'));
  button.addEventListener('click', () => openMenu(button, typeof items === 'function' ? items() : items));
  return button;
}

// Why connect Notion: the advantages as a list (an icon tile, a bold lead, a sentence). count: only the first few.
// compact: a small plain icon instead of the tile, for a card that already has its own tile (Optional extras).
export function notionBenefits(count = NOTION_BENEFITS.length, {compact = false} = {}) {
  const list = el('ul', compact ? 'ui-benefits is-compact' : 'ui-benefits');
  for (const item of NOTION_BENEFITS.slice(0, count)) {
    const line = el('li');
    line.append(compact ? icon(item.icon, 'icon ui-benefit-icon') : tile(item.icon, 'signal'), el('span', 'ui-benefit-text'));
    line.lastChild.append(el('b', '', `${item.lead}:`), ` ${item.text}`);
    list.append(line);
  }
  return list;
}

// A page that needs Notion, until it is connected: the reason, the advantages and one button (pages/notion-connect.js).
export function notionGate({reasonText = '', onConnect = () => {}} = {}) {
  const card = el('section', 'card ui-gate');
  const connect = el('button', 'primary', 'Connect with Notion');
  connect.type = 'button';
  connect.addEventListener('click', onConnect);
  card.append(el('h2', '', GATE_TITLE), ...(reasonText ? [el('p', 'ui-gate-reason', reasonText)] : []), notionBenefits(),
    el('p', 'muted small', GATE_FOOTNOTE), connect);
  return card;
}

// A number that changes while you look at it (a refresh scores, closes, writes) flashes once: up and down in their own colour, the card it
// sits in glows with it. Not on the first value, not when it is the same, not with reduced motion (components.css .count-up/.count-down).
// Owner, 7 Oct 2026: "flash it every time it increases/decreases".
export function setCount(node, value) {
  if (!node) return;
  const before = Number(node.textContent), after = Number(value);
  node.textContent = value;
  if (node.dataset.counted !== '1') { node.dataset.counted = '1'; return; }
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) return;
  const card = node.closest('.stat') || node;
  for (const target of new Set([node, card])) {
    target.classList.remove('count-up', 'count-down');
    void target.offsetWidth;   // restart the animation when it changes twice in a row
    target.classList.add(after > before ? 'count-up' : 'count-down');
  }
}

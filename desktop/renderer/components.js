// Job Pilotto's UI building blocks (styles in components.css, values in tokens.css). Screens build their
// pills, tags, tiles and ⋯ menus with these, so the same thing looks and behaves the same everywhere;
// gallery.html shows every one of them side by side.
import {icon} from './icons.js';

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
    check.append(icon('check-circle'));
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
export function closeMenu() {
  menu.hidden = true;
  document.querySelector('.ui-more[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
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
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', event => { closeMenu(); item.run(event); });
    return button;
  }));
  menu.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  const box = anchor.getBoundingClientRect();
  const below = box.bottom + 6 + menu.offsetHeight <= window.innerHeight;
  menu.style.top = `${Math.max(8, below ? box.bottom + 6 : box.top - menu.offsetHeight - 6)}px`;
  menu.style.left = `${Math.max(8, box.right - menu.offsetWidth)}px`;
  menu.querySelector('button')?.focus();
}
document.addEventListener('click', event => { if (!menu.hidden && !event.target.closest('.ui-menu, .ui-more')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
document.addEventListener('scroll', closeMenu, true);

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

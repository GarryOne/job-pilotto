// The Documents tab's row grid: one label → value row per fact (owner's rule, 18 Oct 2026: no caption lines above or below a button row), the
// cards' buttons (one primary, the rest the same secondary) and the letter's inset text panel. Guarded by test/job-documents.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';

// rows([[label, [nodes or text]]], {top: [labels that sit at the top of a tall value]}) → dl.summary-rows.
export function rows(pairs, {top = ['Text']} = {}) {
  const list = el('dl', 'summary-rows is-compact doc-rows');
  for (const [label, value] of pairs) {
    const cell = el('dd', 'doc-value');
    cell.append(...value.filter(part => part !== '').map(part => (part instanceof Node ? part : document.createTextNode(part))));
    const name = el('dt', '', label);
    if (top.includes(label)) name.classList.add('is-top');
    list.append(name, cell);
  }
  return list;
}

// A card button: the card's one primary, else the standard secondary.
export function docButton(label, run, primary = false) {
  const node = Object.assign(el('button', primary ? 'primary' : 'secondary', label), {type: 'button'});
  node.addEventListener('click', run);
  return node;
}

export function docCopy(text, label = 'Copy', primary = false) {
  const node = docButton(label, () => navigator.clipboard.writeText(text).then(() => { node.textContent = 'Copied ✓'; setTimeout(() => { node.textContent = label; }, 1500); }), primary);
  node.title = 'Copy to the clipboard';
  return node;
}

// The letter as one block: normal paragraph spacing, scrolling when long.
export function letterPanel(text) {
  const panel = el('div', 'letter-shown');
  panel.append(...text.split(/\n\s*\n/).map(part => el('p', '', part)));
  return panel;
}

// A document's card: the mockup's icon tile (a tinted rounded square with a line icon) then the title, and the rows under them.
export function docCard(title, iconName, tone, ...content) {
  const box = el('section', 'jd-card');
  const head = el('div', `doc-head tone-${tone}`);
  const mark = el('span', 'jd-tile-icon');
  mark.append(icon(iconName));
  head.append(mark, el('h3', '', title));
  box.append(head, ...content);
  return box;
}

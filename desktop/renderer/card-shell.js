// The shared card shell of Profile and Strategy cards (owner, 18 Oct 2026, UI redesign: "on the edit states of cards ... so nice, so clean"): a card reads
// as a compact summary (label → value rows, chips), a quiet Edit sits at the right of its title line (components.js cardEdit), Edit opens the editor in
// place (Edit hidden, the card kept open, drafts kept) with an aligned label column and full-width controls, and nothing is saved per card: the page's one
// save bar saves (save-bar.js). The rules: docs/rules/desktop-ui.md "Cards: read → Edit → editor". Guarded by test/card-shell.test.js and test/card-system.test.js.
import {chip, el, pill, unfold} from './components.js';

const isNode = value => value && typeof value === 'object' && 'tagName' in value;

// The read view: one row per fact, label then value. value: text or a node (chips); empty → "Not set" (warn) unless missing: '' asks for silence;
// note: a muted line under the value (a note for the AI, a date it was confirmed), never inside it.
export function readRows(rows, {lined = false} = {}) {
  const list = el('dl', `summary-rows is-compact${lined ? ' is-lined' : ''}`);
  for (const {label, value, note = '', missing = 'Not set'} of rows) {
    const empty = value == null || (!isNode(value) && !String(value).trim());
    if (empty && missing === '') continue;
    const cell = el('dd');
    cell.append(empty ? pill(missing, 'warn') : isNode(value) ? value : String(value));
    if (note) cell.append(el('span', 'read-note muted small', note));
    list.append(el('dt', '', label), cell);
  }
  return list;
}

// Several values of one kind on one line (languages, countries): chip(text, {detail}) each, e.g. English · B2.
export function chipLine(items) {
  const line = el('div', 'read-values');
  line.append(...items.map(item => (typeof item === 'string' ? chip(item) : chip(item.text, {detail: item.detail || '', tone: item.tone || ''}))));
  return line;
}

// The editor: label column aligned down the card, controls full width beside it (mockup 01). rows: [{label, control, hint}]; control is any node.
export function editRows(rows) {
  const box = el('div', 'edit-rows');
  for (const {label, control, hint = ''} of rows) {
    const row = el('label', 'edit-row');
    const words = el('span', 'edit-label', label);
    const right = el('span', 'edit-control');
    right.append(control);
    if (hint) right.append(el('span', 'muted small', hint));
    row.append(words, right);
    box.append(row);
  }
  return box;
}

// A card enters or leaves its editor: .is-editing on the card (CSS hides its Edit and shows .card-editor instead of .card-read), and a folded card opens
// without remembering it as the person's choice. Leaving the editor never drops a draft: the card's draft lives with its save-bar source until Save or Discard.
export function setEditing(card, on) {
  if (!card) return;
  card.classList.toggle('is-editing', Boolean(on));
  if (on) unfold(card);
}
export const isEditing = card => Boolean(card?.classList.contains('is-editing'));

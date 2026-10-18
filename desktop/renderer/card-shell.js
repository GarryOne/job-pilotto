// The shared card shell of Profile and Strategy cards (owner, 18 Oct 2026, UI redesign: "on the edit states of cards ... so nice, so clean"): a card reads
// as a compact summary (label → value rows, chips), a quiet Edit sits at the right of its title line (components.js cardEdit), Edit opens the editor in
// place (Edit hidden, the card kept open, drafts kept) with an aligned label column and full-width controls, and nothing is saved per card: the page's one
// save bar saves (save-bar.js). The rules: docs/rules/desktop-ui.md "Cards: read → Edit → editor". Guarded by test/card-shell.test.js and test/card-system.test.js.
import {chip, el, pill, tile, unfold} from './components.js';
import {icon as glyph} from './icons.js';

const isNode = value => value && typeof value === 'object' && 'tagName' in value;

// The read view: one row per fact, label then value. value: text or a node (chips); empty → "Not set" (warn) unless missing: '' asks for silence;
// note: a muted line under the value (a note for the AI, a date it was confirmed), never inside it.
// icon: an icon name drawn before the label (roomy cards, mockup 03: icon · small grey label · bold value).
export function readRows(rows, {lined = false} = {}) {
  const list = el('dl', `summary-rows is-compact${lined ? ' is-lined' : ''}${rows.some(row => row.icon) ? ' has-icons' : ''}`);
  for (const {label, value, note = '', missing = 'Not set', icon = ''} of rows) {
    const empty = value == null || (!isNode(value) && !String(value).trim());
    if (empty && missing === '') continue;
    const cell = el('dd'), term = el('dt');
    cell.append(empty ? pill(missing, 'warn') : isNode(value) ? value : String(value));
    if (note) cell.append(el('span', 'read-note muted small', note));
    term.append(...(icon ? [glyph(icon)] : []), label);
    list.append(term, cell);
  }
  return list;
}

// A roomy card's header (mockup 03): icon tile · title (a status pill after it) over its one-line lead · the action at the right (cardEdit, or Done).
export function cardHead({glyph = 'info', tone = 'neutral', title = '', lead = '', badge = null, action = null} = {}) {
  const head = el('div', 'card-head'), words = el('div', 'card-words'), heading = el('h3', '', title);
  if (badge) heading.append(badge);
  words.append(heading, ...(lead ? [el('p', 'muted small', lead)] : []));
  head.append(tile(glyph, tone), words, ...(action ? [action] : []));
  return head;
}

// A list setting as read (roomy cards, mockup 03 "Preferred locations"): its small heading, a qualifier joined to it ("· ranked first", never a lone line
// under the chips), then its chips or whatever node shows it.
export function settingBlock(title, body, {qualifier = ''} = {}) {
  const block = el('div', 'setting-block'), head = el('p', 'setting-block-head', title);
  if (qualifier) head.append(el('span', 'muted', `· ${qualifier}`));
  block.append(head, body);
  return block;
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

// The editor's way out while it holds no change: a quiet "Done" (shown only at 0 changes; with changes the page bar's Save all / Discard all decide,
// and the card's save/discard close it). count: the card's own draft count; call done.sync() after each edit. Every card uses this one, not its own Close.
export function doneButton(card, count) {
  const done = Object.assign(el('button', 'link small card-done', 'Done'), {type: 'button'});
  const sync = () => { done.hidden = count() > 0; };
  done.addEventListener('click', () => setEditing(card, false));
  sync();
  return Object.assign(done, {sync});
}

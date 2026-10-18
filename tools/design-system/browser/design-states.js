// The design-system page's "States" sections: the shared parts (card-shell.js, save-bar.js, components.js) in the states a screen meets, on fictional data:
// unsaved / saving / save failed, empty / loading / error, long content, and a narrow window. Nothing here draws its own look: it only sets the parts up.
import {cardEdit, el, loadingCard} from '../r/components.js';
import {chipLine, editRows, readRows, setEditing} from '../r/card-shell.js';
import {pageSaveBar} from '../r/save-bar.js';
import {fillIcons, icon} from '../r/icons.js';
import {refresh, segmented} from '../r/question-control-values.js';

const root = document.getElementById('gallery');
const section = (title, note, ...children) => {
  const box = el('section', 'g-section');
  box.append(el('h2', '', title), el('p', 'muted small', note), ...children);
  root.append(box);
};
const frame = (caption, node, width = '') => {
  const box = el('figure', 'state-frame');
  if (width) box.style.maxWidth = width;
  box.append(Object.assign(el('figcaption', 'muted small', caption)), node);
  return box;
};
const grid = (...children) => { const box = el('div', 'state-grid'); box.append(...children); return box; };
const stack = (...children) => { const box = grid(...children); box.classList.add('is-stack'); return box; };

function card(title, body) {
  const panel = el('div', 'setting panel');
  const top = el('div', 'panel-top'), head = el('div', 'summary-head');
  head.append(icon('globe'), el('h3', '', title));
  top.append(head, cardEdit('Edit', title.toLowerCase(), () => setEditing(panel, true)));
  panel.append(top, body);
  return panel;
}
const TABS = {details: 'Your details', experience: 'Experience'};
// A save bar on its own host, with drafts on two tabs; `then` runs the state under test (a save that hangs, a save that fails).
function barState(save, then) {
  const host = el('div', 'state-bar-host');
  const bar = pageSaveBar({host, tabs: TABS, words: 'Your drafts are kept while you switch tabs.'});
  bar.register({id: 'languages', tab: 'details', label: 'Languages', count: () => 1, save, discard: () => {}});
  bar.register({id: 'summary', tab: 'experience', label: 'Summary', count: () => 1, save: async () => ({ok: true}), discard: () => {}});
  if (then) then(bar);
  return host;
}

section('States: save', 'The page save bar while drafts are unsaved, while saving and when a save fails (save-bar.js). A failed save keeps the drafts and names the tab and field.',
  stack(frame('Unsaved changes', barState(async () => ({ok: true}))),
    frame('Saving', barState(() => new Promise(() => {}), bar => bar.saveAll())),
    frame('Save failed', barState(async () => ({ok: false, field: 'Russian', error: 'pick a level'}), bar => bar.saveAll()))));

const rows = [{label: 'Can work in', value: 'English, Romanian, Russian', note: 'No French, German or Italian.'}, {label: 'Certificates', value: ''}];
const reading = items => { const box = el('div', 'card-read'); box.append(chipLine(items), readRows(rows)); return box; };
const LANGS = [{text: 'English', detail: 'B2'}, {text: 'Romanian', detail: 'Native'}, {text: 'Russian', detail: 'B1'}];
const empty = () => { const box = el('div', 'card-read'); box.append(readRows([{label: 'Languages', value: ''}, {label: 'Can work in', value: ''}])); return box; };
const failed = () => {
  const box = el('div', 'alert tone-bad');
  box.innerHTML = '<i data-icon="info"></i><div><strong>Couldn\'t read your languages</strong><p>Your store didn\'t answer. Try again in a moment.</p><div class="alert-actions"><button class="link">Try again</button></div></div>';
  fillIcons(box);
  return box;
};
const many = Array.from({length: 10}, (_, i) => ({text: ['Kubernetes', 'Observability', 'Terraform', 'PostgreSQL', 'Incident response', 'Python', 'Go'][i % 7] + (i > 6 ? ' (lead)' : '')}));
const longRows = () => { const box = el('div', 'card-read'); box.append(chipLine(many), readRows([{label: 'Summary', value: 'Platform engineer with eleven years running production systems for logistics and fintech teams, most recently leading an on-call rotation of nine across three time zones and cutting incident hours by a third.'}])); return box; };

section('States: empty, loading, error', 'A card with nothing yet shows "Not set" and its action; a card still reading shows the shared shimmer; a failed read says what happened and offers a retry.',
  grid(frame('Empty', card('Languages', empty())), frame('Loading', loadingCard('Reading your languages from your store…')), frame('Error', failed())));
section('States: long content and narrow windows', 'Nothing is cut: chips wrap, a long value wraps, and the same card holds at a narrow window (360 px).',
  grid(frame('Long content', card('Summary', longRows())), frame('Narrow window · 360 px', card('Languages', reading(LANGS)), '360px')));
section('States: read and edit', 'The same card read, then in its editor (card-shell.js setEditing). Edit hides while editing; drafts go to the page save bar.', (() => {
  const level = value => { let chosen = value; const isOn = option => option === chosen; return segmented(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native'], isOn, (option, group) => { chosen = option; refresh(group, isOn); }, 'Level'); };
  const editing = card('Languages', (() => { const box = el('div', 'card-editor'); box.append(editRows(LANGS.map(item => ({label: item.text, control: level(item.detail)})))); return box; })());
  setEditing(editing, true);
  return grid(frame('Read', card('Languages', reading(LANGS))), frame('Edit', editing));
})());

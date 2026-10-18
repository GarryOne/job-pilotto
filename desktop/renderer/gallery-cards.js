// The component gallery's "Card shell" section: one card read, the same card in its editor, and the page save bar with drafts on two tabs, all drawn by
// the shared parts (card-shell.js, components.js cardEdit, save-bar.js), so the gallery is the living copy of docs/rules/desktop-ui.md "Cards: read → Edit → editor".
import {cardEdit, el} from './components.js';
import {chipLine, editRows, readRows, setEditing} from './card-shell.js';
import {pageSaveBar} from './save-bar.js';
import {icon} from './icons.js';

function card(title, editing) {
  const panel = el('div', 'setting panel');
  const top = el('div', 'panel-top');
  const head = el('div', 'summary-head');
  head.append(icon('globe'), el('h3', '', title));
  top.append(head, cardEdit('Edit', title.toLowerCase(), () => setEditing(panel, true)));
  const read = el('div', 'card-read');
  read.append(chipLine([{text: 'English', detail: 'B2'}, {text: 'Romanian', detail: 'Native'}, {text: 'Russian', detail: 'B1'}]),
    readRows([{label: 'Can work in', value: 'English, Romanian, Russian', note: 'No French, German or Italian.'}, {label: 'Certificates', value: ''}]));
  const level = value => { const menu = el('select'); for (const option of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native']) menu.append(new Option(option, option)); menu.value = value; return menu; };
  const editor = el('div', 'card-editor');
  editor.append(editRows([{label: 'English', control: level('B2')}, {label: 'Romanian', control: level('Native')}, {label: 'Russian', control: level('B1')}]));
  panel.append(top, el('p', 'muted panel-lead', 'The languages you speak, with your level.'), read, editor);
  setEditing(panel, editing);
  return panel;
}

export function cardSystem() {
  const box = el('div', 'settings-page');
  const tabs = el('div', 'tabs');
  const buttons = Object.fromEntries([['details', 'Your details'], ['experience', 'Experience'], ['answers', 'Application answers']].map(([key, label]) => {
    const button = el('button', '', label);
    tabs.append(button);
    return [key, button];
  }));
  box.append(tabs, card('Languages', false), card('Languages', true));
  const bar = pageSaveBar({host: box, tabs: {details: 'Your details', experience: 'Experience', answers: 'Application answers'}, tabButton: key => buttons[key],
    words: 'Your drafts are kept while you switch tabs.'});
  for (const [id, tab] of [['languages', 'details'], ['summary', 'experience']]) bar.register({id, tab, label: id, count: () => 1, save: async () => ({ok: true}), discard: () => {}});
  return box;
}

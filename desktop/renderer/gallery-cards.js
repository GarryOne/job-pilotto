// The component gallery's "Card shell" section: one card read, the same card in its editor, and the page save bar with drafts on two tabs, all drawn by
// the shared parts (card-shell.js, components.js cardEdit, save-bar.js), so the gallery is the living copy of docs/rules/desktop-ui.md "Cards: read → Edit → editor".
import {cardEdit, el} from './components.js';
import {chipLine, editRows, readRows, setEditing} from './card-shell.js';
import {pageSaveBar} from './save-bar.js';
import {emptyState, referenceRow, reviewList, summaryTiles} from './page-parts.js';
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

// The page blocks (page-parts.js) with fictional demo values: review list, empty state, summary tiles, reference row.
export function pageBlocks() {
  const box = el('div', 'settings-page');
  const panel = (title, ...parts) => { const node = el('div', 'setting panel'); node.append(el('h3', '', title), ...parts); return node; };
  box.append(
    panel('reviewList', reviewList([
      {key: 'budget', title: 'Budget ownership', why: 'Asked in 4 of your 5 best matches', source: 'From the CV check', status: {text: 'Needs review', tone: 'warn'},
        actions: [{label: 'Confirm', primary: true}, {label: 'Dismiss'}]},
      {key: 'spanish', title: 'Spanish', why: 'Asked in 2 of your 5 best matches', status: {text: 'Needs review', tone: 'warn'}, actions: [{label: 'Review', primary: true}]},
      {key: 'lead', title: 'Team leadership', why: 'Added to Experience', status: {text: 'Confirmed', tone: 'good'}, done: true},
    ])),
    panel('emptyState', emptyState({icon: 'file', title: 'No base letter yet', text: 'One general letter, written from your CV and Profile; each job still gets its own.',
      actions: [{label: 'Draft with AI'}, {label: 'Write my own'}], note: 'Drafting uses your AI once.'})),
    panel('summaryTiles', summaryTiles([{key: 'role', icon: 'target', tone: 'signal', label: 'Role', value: 'Operations Manager'},
      {key: 'where', icon: 'pin', tone: 'info', label: 'Where', value: 'Zurich · Remote'}, {key: 'salary', icon: 'coins', tone: 'good', label: 'Minimum salary', value: 'CHF 140k'},
      {key: 'start', icon: 'calendar', tone: 'neutral', label: 'Start', value: ''}])),
    panel('referenceRow', referenceRow({text: 'Swiss permit B · notice period 3 months'})),
  );
  return box;
}

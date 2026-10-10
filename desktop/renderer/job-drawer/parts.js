// The parts every tab of the job drawer is built from (pages/job-panel.js, job-drawer/tab-*.js): a titled group of lines, a copy button,
// the state card (empty, loading, failed, notice: one component, so every tab says "nothing yet" the same way), the key-facts grid and
// the loading skeleton. DOM builders only; the words come from renderer/job-page-view.js. Guarded by test/job-drawer.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';

export function button(label, run, className = 'soft-button') {
  const node = Object.assign(el('button', className, label), {type: 'button'});
  node.addEventListener('click', run);
  return node;
}

export function copyButton(text, label = 'Copy') {
  const node = Object.assign(el('button', 'link', label), {type: 'button', title: 'Copy to the clipboard'});
  node.addEventListener('click', () => navigator.clipboard.writeText(text).then(() => {
    node.textContent = 'Copied ✓';
    setTimeout(() => { node.textContent = label; }, 1500);
  }));
  return node;
}

// A line of a section (job-page-view.js lineOf): bold when it is a question or a label, a to-do with its state, a fold (a Notion toggle:
// "📧 Full message") as the interview review's folded transcript (details.troubleshoot).
export function lineView(line) {
  if (typeof line === 'string') return el('div', 'iv-moment', line);
  if (line.fold !== undefined) {
    const fold = el('details', 'troubleshoot');
    fold.append(el('summary', '', line.fold), ...line.lines.map(lineView));
    return fold;
  }
  const text = line.todo === null ? line.text : `${line.todo ? '☑' : '☐'} ${line.text}`;
  return line.strong ? el('div', 'iv-moment', el('b', '', text)) : el('div', `iv-moment${line.quote ? ' muted' : ''}`, text);
}

// A group: its heading (with an optional button on the right) and one .iv-moment per line.
export function group(title, lines, action = null) {
  const box = el('div', 'iv-moments-group');
  const head = el('h3', '');
  head.append(title);
  if (action) head.append(action);
  if (title) box.append(head);
  box.append(...lines.map(line => (line instanceof Node ? line : lineView(line))));
  return box;
}

// A box with an icon, a bold title, a line and its actions, on the tone's soft background (components.css .alert): "No review yet",
// "Could not read this job", "Score from an earlier profile". tone: info (default), warn, bad, good.
export function stateCard({icon: name = 'info', tone = 'info', title, text = '', actions = []}) {
  const card = el('div', `alert tone-${tone} jd-state`);
  const words = el('div', '');
  words.append(el('b', '', title));
  if (text) words.append(text instanceof Node ? text : el('p', '', text));   // a line, or a node (a short list)
  if (actions.length) { const row = el('div', 'jd-actions'); row.append(...actions); words.append(row); }
  card.append(icon(name), words);
  return card;
}

// Label over value, in a grid: posted, deadline, contract, work mode, salary...
export function factGrid(pairs) {
  const grid = el('div', 'jd-facts');
  for (const [label, value] of pairs) {
    const cell = el('div', 'jd-fact');
    cell.append(el('span', 'muted small', label), el('b', '', String(value)));
    grid.append(cell);
  }
  return grid;
}

// What a tab shows while its page is being read.
export const skeleton = () => [el('span', 'skeleton w-80'), el('span', 'skeleton w-60'), el('span', 'skeleton w-40')];

// A titled card: a heading and its content in a bordered box (the Overview's "At a glance", "What the role involves").
export function card(title, ...content) {
  const box = el('section', 'jd-card');
  box.append(el('h3', '', title), ...content);
  return box;
}

// One fact as a tile: an icon square, the label, the value (muted when the posting does not say) and a note. tone: the icon square's colour.
export function factTile({icon: name, tone = 'info', label, value, note = '', known = true}) {
  const tile = el('div', `jd-tile tone-${tone}`);
  const mark = el('span', 'jd-tile-icon');
  mark.append(icon(name));
  const words = el('div', 'jd-tile-words');
  words.append(el('span', 'muted small', label), el('b', known ? '' : 'muted', value));
  if (note) words.append(el('span', 'muted small', note));
  tile.append(mark, words);
  return tile;
}

// A line with a small icon in front (what the role involves).
export function iconRow(name, text) {
  const row = el('div', 'jd-icon-row');
  const mark = el('span', 'jd-row-icon');
  mark.append(icon(name));
  row.append(mark, el('span', '', text));
  return row;
}

// A choice of a few options, one active (components.css .segmented): Application's Preparation / Submitted. options: [[key, label]].
export function choice(options, active, pick, label) {
  const box = el('div', 'segmented jd-choice');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', label);
  for (const [key, text] of options) {
    const node = Object.assign(el('button', key === active ? 'is-active' : '', text), {type: 'button'});
    node.setAttribute('aria-pressed', String(key === active));
    node.addEventListener('click', () => pick(key));
    box.append(node);
  }
  return box;
}

// A strip of facts in one box, each with a round icon, a label, a value and a note (the Description tab's Employer / Posted / First found /
// Saved posting). cells: [{icon, label, value, note}].
export function factStrip(cells) {
  const strip = el('div', 'jd-strip');
  for (const cell of cells) {
    const box = el('div', 'jd-strip-cell');
    const mark = el('span', 'jd-strip-icon');
    mark.append(icon(cell.icon));
    const words = el('div', 'jd-tile-words');
    words.append(el('span', 'muted small', cell.label), el('b', '', cell.value));
    if (cell.note) words.append(el('span', 'muted small', cell.note));
    box.append(mark, words);
    strip.append(box);
  }
  return strip;
}

// A posting's blocks (renderer/job-page-view.js postingBlocks) as headings, bullet lists and paragraphs.
export function postingBody(blocks) {
  const body = el('div', 'jd-posting');
  for (const block of blocks) {
    if (block.kind === 'heading') body.append(el('h4', '', block.text));
    else if (block.kind === 'list') {
      const list = el('ul', 'jd-list');
      list.append(...block.items.map(text => el('li', '', text)));
      body.append(list);
    } else body.append(el('p', '', block.text));
  }
  return body;
}

// Where the text came from, with the way to the original: an icon, "Source", the words and the button.
export function sourceCard(words, original) {
  const box = el('div', 'jd-source');
  const mark = el('span', 'jd-strip-icon');
  mark.append(icon('file'));
  const text = el('div', 'jd-tile-words');
  text.append(el('span', 'muted small', 'Source'), el('b', '', words));
  box.append(mark, text, original);
  return box;
}

// A message as a card that folds: an icon, its title, a pill with what it was (Interview scheduled), the date; folded content below.
// open: shown unfolded (the newest).
export function foldCard({iconName = 'mail', title, tag: pillText = '', when = '', open = false}, ...content) {
  const card = el('details', 'jd-message');
  card.open = open;
  const head = el('summary', 'jd-message-head');
  const mark = el('span', 'jd-message-icon');
  mark.append(icon(iconName));
  const words = el('span', 'jd-message-title');
  words.append(el('b', '', title));
  if (pillText) words.append(el('span', 'ui-pill tone-info', pillText));
  head.append(mark, words, el('span', 'muted small', when));
  const body = el('div', 'jd-message-body');
  body.append(...content);
  card.append(head, body);
  return card;
}

// A posting the last search no longer listed (page.match.status "Not seen"): not proof it closed, and what the app saved is kept.
export const closedCard = () => stateCard({icon: 'alert', tone: 'warn', title: 'Not seen in the last search',
  text: 'The posting may have closed or moved. What the app saved about it (its facts, score and text) is kept.'});

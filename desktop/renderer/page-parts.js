// Shared page blocks of the UI redesign (owner, 18 Oct 2026, via the coordinator: "the design system needs these before B, C and D each build their own"):
// a review list (pending first, done folded as "Reviewed · N"), an empty state ("Not created" + one line + two actions), summary tiles (icon, label, big
// value), and a read-only reference row ("From Your details" + one link). Styles: page-parts.css. Rules: docs/rules/desktop-ui.md "Page blocks".
// Living copy: npm run gallery → "Page blocks". Guarded by test/page-parts.test.js.
import {el, pill, tile} from './components.js';

const button = (label, className, run) => {
  const node = Object.assign(el('button', className, label), {type: 'button'});
  node.addEventListener('click', run);
  return node;
};

// A list of things to review (CV gaps, Needs review, CV check fixes): each item is its title, why it is here and where it came from, a status chip and its
// actions. Pending items come first in the order given; done ones fold under "Reviewed · N". items: [{key, title, why?, source?, status: {text, tone}, done?,
// actions: [{label, run, primary?}], detail?: a node folded under "View details" (the fix text, its source)}]; a done item keeps its actions (Undo), quiet. Filled orange is the list's ONE next step: the first pending item's primary action; every other action is quiet.
export function reviewList(items = [], {doneLabel = 'Reviewed', empty = 'Nothing to review.'} = {}) {
  const box = el('div', 'review-list');
  let lead = false;   // the list's one orange button is drawn
  const row = item => {
    const node = el('li', `review-item${item.done ? ' is-done' : ''}`);
    node.dataset.key = item.key || '';
    const main = el('div', 'review-main');
    main.append(el('b', '', item.title || ''));
    if (item.why) main.append(el('span', 'muted', item.why));
    if (item.source) main.append(el('span', 'muted small review-source', item.source));
    if (item.detail) { const fold = el('details', 'plain review-detail'); fold.append(el('summary', 'link small', item.detailLabel || 'View details'), item.detail); main.append(fold); }
    const actions = el('div', 'review-actions');
    for (const action of item.actions || []) {
      const primary = action.primary && !item.done && !lead && (lead = true);
      actions.append(button(action.label, `${primary ? 'primary' : 'secondary'} small-btn`, () => action.run?.(item)));
    }
    node.append(main, item.status ? pill(item.status.text, item.status.tone || 'neutral') : el('span'), actions);
    return node;
  };
  const pending = items.filter(item => !item.done), done = items.filter(item => item.done);
  if (!items.length) { box.append(el('p', 'muted', empty)); return box; }
  if (pending.length) { const list = el('ul', 'review-items'); list.append(...pending.map(row)); box.append(list); }
  if (done.length) {
    const fold = el('details', 'plain review-done'), list = el('ul', 'review-items');
    list.append(...done.map(row));
    fold.append(el('summary', 'muted small', `${doneLabel} · ${done.length}`), list);
    box.append(fold);
  }
  return box;
}

// Something not made yet (a base letter, a first CV): a neutral chip, an icon, a title, one line, then two actions (the first is the primary next step,
// the second quiet) and an optional muted note under them. actions: [{label, run}] (at most two).
export function emptyState({icon = 'file', chip = 'Not created', title = '', text = '', actions = [], note = ''} = {}) {
  const box = el('div', 'empty-state');
  box.append(tile(icon, 'neutral'));
  if (chip) box.append(pill(chip, 'neutral'));
  if (title) box.append(el('b', 'empty-state-title', title));
  if (text) box.append(el('p', 'muted', text));
  if (actions.length) {
    const row = el('div', 'empty-state-actions');
    row.append(...actions.slice(0, 2).map((action, i) => button(action.label, i === 0 ? 'primary' : 'secondary', () => action.run?.())));
    box.append(row);
  }
  if (note) box.append(el('p', 'muted small', note));
  return box;
}

// A row of figures with an icon each (Main goals, CV scores): icon on its tone, label, the value big; an empty value reads "Not set". Four columns, two by two
// when the card is narrow. tiles: [{key, icon, tone, label, value, note?, title?}].
export function summaryTiles(tiles = []) {
  const box = el('div', 'summary-tiles');
  for (const {key = '', icon = 'info', tone = 'neutral', label = '', value = '', note = '', title = ''} of tiles) {
    const cell = el('div', 'summary-tile');
    cell.dataset.key = key;
    if (title) cell.title = title;
    const set = String(value ?? '').trim();
    const words = el('div', 'summary-tile-words');
    words.append(el('span', 'summary-tile-label', label), el('b', `summary-tile-value${set ? '' : ' is-empty'}`, set || 'Not set'));
    if (note) words.append(el('span', 'muted small', note));
    cell.append(tile(icon, tone), words);
    box.append(cell);
  }
  return box;
}

// A fact shown on one page but kept on another (Strategy's or Cover letter's view of Your details): where it comes from, the words, one quiet link there.
// open(): opens the page and card that holds it (pages/settings.js openSetting(key)).
export function referenceRow({text = '', from = 'From Your details', link = 'Edit in Your details', open = () => {}} = {}) {
  const row = el('div', 'reference-row');
  row.append(el('span', 'muted small reference-from', from), el('span', 'reference-text', text), button(link, 'link small', () => open()));
  return row;
}

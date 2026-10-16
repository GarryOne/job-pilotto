// Settings → Profile: a text drawn as cards instead of one textarea (the editor in text-editors.js shows it when the text can be edited here).
// Standard answers and the Profile: a section per heading, a card per item (its label, a field for the value). Form knowledge: a section per
// site ("any" first), a card per note (question, value field, kind chip, reason, Remove). A line the model can't read is a "Kept as is" card.
// Rows come from renderer/text-model.js, which writes the same text format back; typing edits one row, only Remove/Add redraw.
// Guarded by test/text-cards.test.js and test/text-model.test.js.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {newItem, parseText, sectionEnd, sections, serializeText, withNote, withValue} from '../text-model.js';

const KIND_TONE = {answer: 'good', option: 'info', meaning: 'violet', widget: 'teal'};
const KIND_HINT = {answer: 'A typed answer', option: 'A choice from a list', meaning: 'What the question means', widget: 'How the control works'};
const grow = area => { area.rows = Math.min(8, Math.max(1, Math.ceil(area.value.length / 80) + area.value.split('\n').length - 1)); };

function field(value, label, onInput) {
  const area = Object.assign(el('textarea', ''), {value, rows: 1, spellcheck: true, ariaLabel: label});
  grow(area);
  area.addEventListener('input', () => { grow(area); onInput(area.value); });
  return area;
}

// → {node, text(), reset(text), add: bool, adding(), searchBox}; `changed` is called after every edit with the new text.
export function cardsEditor(name, text, changed) {
  let rows = parseText(name, text), query = '', adding = false;
  const node = el('div', 'text-cards'), list = el('div', 'text-cards-list');
  const search = Object.assign(el('input', ''), {type: 'search', placeholder: name === 'knowledge' ? 'Search questions, sites, answers' : 'Search', ariaLabel: 'Search this text'});
  const box = el('div', 'select-search');
  box.append(icon('search'), search);
  const count = el('span', 'muted small');
  const bar = el('div', 'text-cards-bar');
  bar.append(box, count);
  node.append(bar, list);

  const edit = (at, next) => { rows[at] = next; changed(serializeText(rows)); };
  const remove = at => { rows.splice(at, 1); changed(serializeText(rows)); draw(); };
  const matches = row => !query || [row.title, row.label, row.field, row.site, row.kind, row.reason, row.value, row.raw].some(part => String(part || '').toLowerCase().includes(query));

  function card({row, at}) {
    const item = el('div', 'answer-item text-card');
    const head = el('div', 'text-card-head');
    if (row.type === 'note') {
      const kind = pill(row.kind, KIND_TONE[row.kind] || 'neutral', {title: KIND_HINT[row.kind] || ''});
      head.append(el('b', '', row.field), kind);
      // A note with an answer: the answer is the field and the reason sits under it; one without (a meaning, a widget) is its reason.
      if (row.hasValue) {
        item.append(head, field(row.value, `${row.field}: value`, value => edit(at, withNote(rows[at], {value}))));
        item.append(el('p', 'muted small text-card-reason', row.reason));
      } else item.append(head, field(row.reason, `${row.field}: what it means`, reason => edit(at, withNote(rows[at], {reason}))));
    } else if (row.type === 'item') {
      head.append(el('b', '', row.label));
      item.append(head, field(row.value, row.label, value => edit(at, withValue(rows[at], value))));
    } else if (row.type === 'bullet') {
      item.append(head, field(row.value, 'Line', value => edit(at, withValue(rows[at], value))));
    } else {
      head.append(el('b', 'text-card-raw', row.raw.trim()), pill('Kept as is', 'neutral', {title: "Job Pilotto can't show this line as a card; it stays in the text exactly as it is."}));
      item.append(head);
    }
    const drop = Object.assign(el('button', 'link', 'Remove'), {type: 'button', title: 'Remove this line'});
    drop.addEventListener('click', () => remove(at));
    head.append(drop);
    return item;
  }

  function addRow() {
    const form = el('div', 'text-card-add answer-item');
    const heads = rows.map((row, at) => ({row, at})).filter(({row}) => row.type === 'heading');
    const where = Object.assign(el('select', ''), {ariaLabel: 'Section'});
    if (!heads.length || rows.slice(0, heads[0].at).some(row => row.type === 'item' || row.type === 'bullet')) where.append(new Option('(top)', '-1'));
    heads.forEach(({row, at}) => where.append(new Option(row.title, String(at))));
    where.value = where.options[where.options.length - 1].value;
    const label = Object.assign(el('input', ''), {placeholder: 'Question or name', ariaLabel: 'Name'});
    const value = Object.assign(el('input', ''), {placeholder: 'Answer', ariaLabel: 'Value'});
    const ok = Object.assign(el('button', 'primary', 'Add'), {type: 'button'});
    ok.addEventListener('click', () => {
      if (!label.value.trim()) { label.focus(); return; }
      rows.splice(sectionEnd(rows, Number(where.value)), 0, newItem(label.value, value.value));
      adding = false; changed(serializeText(rows)); draw();
    });
    form.append(where, label, value, ok);
    return form;
  }

  function draw() {
    const groups = sections(name, rows);
    list.replaceChildren();
    if (adding) list.append(addRow());
    let shown = 0, total = 0;
    for (const group of groups) {
      const items = group.items.filter(({row}) => row.type !== 'heading');
      total += items.length;
      const visible = items.filter(({row}) => matches(row) || (group.heading && matches(group.heading.row) && query));
      shown += visible.length;
      if (query && !visible.length) continue;
      const section = el('section', 'text-cards-section');
      if (group.key) { const head = el('div', 'text-cards-head'); head.append(el('h4', '', group.key)); if (items.length) head.append(el('span', 'muted small', `${items.length}`)); section.append(head); }
      const cards = el('div', 'answer-list');
      cards.append(...visible.map(card));
      section.append(cards);
      list.append(section);
    }
    if (!list.children.length || (query && !shown)) list.append(el('p', 'muted', query ? 'No line matches your search.' : 'Nothing here yet.'));
    count.textContent = query ? `${shown} of ${total}` : `${total} line${total === 1 ? '' : 's'}`;
  }
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); draw(); });
  draw();
  return {
    node, search,
    text: () => serializeText(rows),
    reset(next) { rows = parseText(name, next); draw(); },
    canAdd: name !== 'knowledge',
    toggleAdd() { adding = !adding; draw(); return adding; },
  };
}

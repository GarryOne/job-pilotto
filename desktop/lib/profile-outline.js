// The Profile page on Notion as the Profile form's data (Settings → Profile → Preferences): the page's outline (headings, tables with their rows,
// bullets) becomes the same sections the local text gives (renderer/profile-model.js), with the id of every row and bullet, so the form can change
// ONE cell or ONE bullet through the store (page.setCell / page.setText) and leave every other block of the page as it is. Notes and the rest of the
// page come back as read-only text (edited on the Notion page). Guarded by test/profile-outline.test.js.
import {kindOf} from '../renderer/profile-model.js';

const HEADINGS = ['heading_1', 'heading_2', 'heading_3'];
const LABELLED = /^([^:|]{1,60}):\s*(.*)$/;   // "Target: CHF 150k", the same bullet shape the local parser reads

// items: store.page('profile').outline() -> {sections: [{kind, heading, notes, header, rows: [{id, cells}], bullets: [{id, label, value}]}], rest}
export function fromOutline(items) {
  const sections = [], rest = [];
  let current = null;
  for (const item of items || []) {
    if (HEADINGS.includes(item.type)) {
      const kind = kindOf(item.text);
      current = kind ? {kind, heading: item.text, notes: [], header: ['', ''], rows: [], bullets: []} : null;
      if (current) sections.push(current); else rest.push(item.text);
    } else if (!current) {
      rest.push(item.type === 'table' ? item.rows.map(row => row.cells.join(' | ')).join('\n') : item.text);
    } else if (item.type === 'table') {
      const body = item.header ? item.rows.slice(1) : item.rows;
      if (item.header && item.rows[0]) current.header = item.rows[0].cells;
      current.rows.push(...body.map(row => ({id: row.id, cells: row.cells})));
    } else if (item.type === 'bulleted_list_item' && LABELLED.test(item.text || '')) {
      const [, label, value] = item.text.match(LABELLED);
      current.bullets.push({id: item.id, label: label.trim(), value: value.trim()});
    } else if (item.text) current.notes.push(item.text);
  }
  return {sections: sections.map(section => ({...section, notes: section.notes.join('\n')})), rest: rest.filter(Boolean).join('\n')};
}

// The blocks the form may change, by id, from a FRESH outline: a row's cells, a bullet's label. Nothing else on the page is reachable.
export function editable(items) {
  const rows = new Map(), bullets = new Map();
  let known = false;
  for (const item of items || []) {
    if (HEADINGS.includes(item.type)) known = !!kindOf(item.text);
    else if (!known) continue;
    else if (item.type === 'table') for (const row of item.header ? item.rows.slice(1) : item.rows) rows.set(row.id, row);   // never a header row
    else if (item.type === 'bulleted_list_item' && LABELLED.test(item.text || '')) bullets.set(item.id, item);
  }
  return {rows, bullets};
}

const oneLine = text => String(text ?? '').replace(/\s*\n\s*/g, ' ').trim().slice(0, 1800);

// changes: [{id, kind: 'cell' | 'bullet', value}] -> {saved, missing: [ids no longer on the page]}; each applied through page (setCell / setText).
export async function applyChanges(page, items, changes) {
  const {rows, bullets} = editable(items);
  let saved = 0;
  const missing = [];
  for (const change of changes) {
    const value = oneLine(change.value);
    if (change.kind === 'cell' && rows.has(change.id)) { await page.setCell(rows.get(change.id), 1, value); saved++; }
    else if (change.kind === 'bullet' && bullets.has(change.id)) {
      const block = bullets.get(change.id);
      await page.setText({id: block.id, type: block.type}, `${block.text.match(LABELLED)[1].trim()}: ${value}`);
      saved++;
    } else missing.push(String(change.id));
  }
  return {saved, missing};
}

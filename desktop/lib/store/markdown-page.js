// A Markdown text (profile.md, answers.md, knowledge.md) read and edited as a page of blocks, the same shape the Notion
// adapter gives (lib/store/notion.js): headings, list items, paragraphs and tables, each with an id. Pure functions over the text;
// lib/store/sqlite.js reads and writes the file. Guarded by desktop/test/store-contract.test.js.
//
// Ids are line numbers (`L<n>`) of the text the block was read from. An edit names the block it read; if that line no longer
// holds the same text (the file changed in between), the edit throws instead of touching the wrong line.

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const ROW = /^\s*\|(.*)\|\s*$/;
const RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

// A cell's own pipe is written `\|` (setCell): split only on the others, and read it back as `|` (#340).
const rawCellsOf = line => line.match(ROW)[1].split(/(?<!\\)\|/).map(cell => cell.trim());
const cellsOf = line => rawCellsOf(line).map(cell => cell.replace(/\\\|/g, '|'));
const id = n => `L${n}`;
const lineOf = blockId => Number(String(blockId).replace(/^[LT]/, ''));

// One line → a block, or null (blank). Table lines are gathered by outline().
function block(line, n) {
  const heading = line.match(HEADING);
  if (heading) return {id: id(n), type: `heading_${heading[1].length}`, text: heading[2].trim()};
  const bullet = line.match(BULLET);
  if (bullet) return {id: id(n), type: 'bulleted_list_item', text: bullet[1].trim()};
  const numbered = line.match(NUMBERED);
  if (numbered) return {id: id(n), type: 'numbered_list_item', text: numbered[1].trim()};
  return line.trim() ? {id: id(n), type: 'paragraph', text: line.trim()} : null;
}

// The page in order: text blocks, and tables as {type: 'table', header, rows: [{id, cells}]} (the header row included, flagged).
export function outline(text) {
  const lines = String(text || '').split('\n'), items = [];
  for (let n = 0; n < lines.length; n++) {
    if (ROW.test(lines[n]) && !RULE.test(lines[n])) {
      const table = {id: `T${n}`, type: 'table', header: RULE.test(lines[n + 1] || ''), rows: []};
      while (n < lines.length && ROW.test(lines[n])) {
        if (!RULE.test(lines[n])) table.rows.push({id: id(n), type: 'table_row', cells: cellsOf(lines[n])});
        n++;
      }
      n--;
      items.push(table);
    } else {
      const each = block(lines[n], n);
      if (each) items.push(each);
    }
  }
  return items;
}

// Every block with text, in order (table rows are not text blocks, as in Notion).
export const blocks = text => outline(text).filter(item => item.type !== 'table');

// Readable text as the AI prompts use it: table rows as "a | b" (Notion: lib/notion-read.js pageText).
export const readable = text => outline(text).flatMap(item => (item.type === 'table' ? item.rows.map(row => row.cells.join(' | ')) : [item.text]))
  .filter(Boolean).join('\n');

function at(lines, blockId, expect) {
  const n = lineOf(blockId);
  if (!(n >= 0 && n < lines.length) || (expect !== undefined && !lines[n].includes(expect))) {
    throw new Error('This page changed since it was read; open it again');
  }
  return n;
}
const one = line => String(line).replace(/\s*\n\s*/g, ' ').trim();
const bullet = line => `- ${one(line)}`;
const prefixOf = line => (line.match(HEADING) ? `${line.match(HEADING)[1]} ` : (line.match(/^(\s*([-*+]|\d+[.)])\s+)/) || ['', ''])[1]);

export function setText(text, item, value) {
  const lines = String(text).split('\n'), n = at(lines, item.id, item.text);
  lines[n] = prefixOf(lines[n]) + one(value);
  return lines.join('\n');
}

export function remove(text, item) {
  const lines = String(text).split('\n');
  lines.splice(at(lines, item.id, item.text), 1);
  return lines.join('\n');
}

export function append(text, values) {
  const body = String(text || '').replace(/\s+$/, '');
  return (body ? `${body}\n` : '') + values.map(bullet).join('\n') + '\n';
}

export function insertAfter(text, blockId, values) {
  const lines = String(text).split('\n');
  lines.splice(at(lines, blockId) + 1, 0, ...values.map(bullet));
  return lines.join('\n');
}

// A "## heading" at the end; returns [text, its id].
export function appendHeading(text, value) {
  const body = String(text || '').replace(/\s+$/, '');
  const lines = (body ? `${body}\n\n## ${one(value)}` : `## ${one(value)}`).split('\n');
  return [lines.join('\n') + '\n', id(lines.length - 1)];
}

// One cell of a table row, the others kept.
export function setCell(text, row, index, value) {
  const lines = String(text).split('\n'), n = at(lines, row.id);
  const cells = rawCellsOf(lines[n]);   // still escaped: written back as they were
  cells[index] = one(value).replace(/\|/g, '\\|');
  lines[n] = `| ${cells.join(' | ')} |`;
  return lines.join('\n');
}

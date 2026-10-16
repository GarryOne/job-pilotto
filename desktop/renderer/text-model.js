// Settings → Profile's three texts (Profile, standard answers, Form knowledge) as rows the cards draw and edit, and back to the same text.
// Pure functions (no DOM): every row keeps the line it came from (`raw`), so a text nobody edited comes back identical, a line the parser
// cannot read stays a raw row (shown, never dropped), and an edit rewrites only its own line. Guarded by test/text-model.test.js.
// The Form knowledge line format is lib/knowledge.js (line/parse); the test checks both read the same lines.

const HEADING = /^(#{1,3})\s+(.*)$/;
const BOLD_ITEM = /^(\s*[-*+]\s+\*\*(.+?)\*\*)( ?)(.*)$/;
const BULLET = /^(\s*[-*+]\s+)(.*)$/;
const NOTE = /^(\s*[-*+]\s+)?\[([^\]]+)\]\s*(.+?):\s(.+?)(?:\s→\s"(.*)")?$/;
export const KINDS = ['answer', 'option', 'meaning', 'widget'];
const clean = text => String(text).replace(/\s*\n\s*/g, ' ').trim();

function rowOf(name, raw) {
  const heading = raw.match(HEADING);
  if (heading) return {type: 'heading', level: heading[1].length, title: heading[2].trim(), raw};
  if (name === 'knowledge') {
    const note = raw.match(NOTE);
    if (note) {
      const [site, kind] = note[2].split(/\s*·\s*/);
      const value = note[5] || '';
      return {type: 'note', bullet: note[1] || '- ', site, kind: kind || (value ? 'answer' : 'meaning'), field: note[3], reason: note[4], value, hasValue: note[5] != null, raw};
    }
    return {type: 'raw', raw};
  }
  const bold = raw.match(BOLD_ITEM);
  if (bold) return {type: 'item', head: bold[1], label: bold[2].replace(/:$/, ''), sep: bold[3], value: bold[4], raw};
  const bullet = raw.match(BULLET);
  if (bullet) return {type: 'bullet', prefix: bullet[1], value: bullet[2], raw};
  return {type: 'raw', raw};
}

// text → rows (blank lines are raw rows too, so the layout survives)
export const parseText = (name, text) => String(text ?? '').split('\n').map(raw => rowOf(name, raw));
export const serializeText = rows => rows.map(row => row.raw).join('\n');

// An edit returns the row with its line rewritten; nothing else in the text moves.
export function withValue(row, value) {
  const text = clean(value);
  if (row.type === 'item') return {...row, value: text, raw: text === row.value ? row.raw : `${row.head}${text ? ' ' : row.sep}${text}`};
  if (row.type === 'bullet') return {...row, value: text, raw: text === row.value ? row.raw : `${row.prefix}${text}`};
  return row;
}
// Form knowledge: the value after → "…" (blank removes the arrow), or the reason, or the kind.
export function withNote(row, change) {
  const next = {...row, ...Object.fromEntries(Object.entries(change).map(([key, value]) => [key, clean(value)]))};
  const same = ['value', 'reason', 'kind'].every(key => next[key] === row[key]);
  const line = `${next.bullet}[${next.site} · ${next.kind}] ${next.field}: ${next.reason}${next.value ? ` → "${next.value}"` : ''}`;
  return {...next, hasValue: !!next.value, raw: same ? row.raw : line};
}

// New rows: a knowledge note is not added by hand (learn.js writes them), an item goes at the end of its section.
export function newItem(label, value) {
  const head = `- **${clean(label).replace(/[*]/g, '')}${/[:?]$/.test(clean(label)) ? '' : ':'}**`;
  return rowOf('answers', `${head} ${clean(value)}`.trimEnd());
}
// Index just after the last non-blank row of the section that starts at `from` (-1 = before the first heading).
export function sectionEnd(rows, from) {
  let end = from + 1;
  for (let i = from + 1; i < rows.length && rows[i].type !== 'heading'; i++) if (rows[i].raw.trim()) end = i + 1;
  return end;
}
// The rows grouped for drawing: [{heading (row or null), rows: [{row, at}]}] with `at` the index in the full list. Knowledge groups by site.
export function sections(name, rows) {
  const groups = [];
  const open = (key, heading) => { const group = {key, heading, items: []}; groups.push(group); return group; };
  let current = null;
  rows.forEach((row, at) => {
    if (name === 'knowledge') {
      if (row.type === 'raw' && !row.raw.trim()) return;
      const key = row.type === 'note' ? row.site : '';
      if (!current || current.key !== key) current = groups.find(group => group.key === key) || open(key, null);
      current.items.push({row, at});
    } else if (row.type === 'heading') current = open(row.title, {row, at});
    else {
      if (!current) current = open('', null);
      if (row.raw.trim()) current.items.push({row, at});
    }
  });
  if (name === 'knowledge') groups.sort((a, b) => (b.key === 'any') - (a.key === 'any'));   // "any" first (stable)
  return groups.filter(group => group.heading || group.items.length);
}

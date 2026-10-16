// Form knowledge as rules (Settings → Profile → Form knowledge): each note of the page's outline ("[site · kind] field: reason → "value"",
// written by lib/learn.js, read by lib/knowledge.js) as {id, text, site, kind, field, reason, value}, and a rule back to its line. A block that is
// not a note (the page's intro, a hand-written line) is kept as {id, text, other: true}: shown, never dropped. No DOM: test/knowledge-model.test.js.

const NOTE = /^\[([^\]]+)\]\s*(.+?):\s(.+?)(?:\s→\s"(.*)")?$/;
export const KINDS = {answer: 'Typed answer', option: 'Option mapping', meaning: 'Field meaning', widget: 'Widget hint'};
export const ANY = 'any';
export const BY_HAND = 'You entered this yourself';   // the reason of a rule added here (as lib/learn.js writes a person's own answer)

export function noteOf(text) {
  const match = String(text || '').match(NOTE);
  if (!match) return null;
  const [site, kind] = match[1].split(/\s*·\s*/);
  const value = match[4] || '';
  return {site: site.trim(), kind: kind || (value ? 'answer' : 'meaning'), field: match[2], reason: match[3], value};
}
const one = text => String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();
export const lineOf = rule => `[${one(rule.site) || ANY} · ${rule.kind}] ${one(rule.field)}: ${one(rule.reason) || BY_HAND}${one(rule.value) ? ` → "${one(rule.value)}"` : ''}`;
// "Name ::" and "Pays/région de résidence:" read as their words.
export const label = field => String(field).replace(/[\s:]+$/, '').trim();

// Every text block of the outline in order (list items, paragraphs; nested ones too), as rules or other lines.
export function rules(items) {
  const out = [];
  const walk = list => {
    for (const item of list || []) {
      if (item.type === 'table' || /^heading_/.test(item.type)) continue;
      if (item.text?.trim()) {
        const note = noteOf(item.text);
        out.push(note ? {id: item.id, text: item.text, ...note} : {id: item.id, text: item.text, other: true});
      }
      walk(item.children);
    }
  };
  walk(items);
  return out;
}
export const sites = list => [...new Set(list.filter(rule => !rule.other).map(rule => rule.site))].sort((a, b) => (b === ANY) - (a === ANY) || a.localeCompare(b));
export const matches = (rule, {query = '', site = '', kind = ''} = {}) => (!site || rule.site === site) && (!kind || rule.kind === kind)
  && (!query || [rule.field, rule.value, rule.reason, rule.site, rule.text].some(part => String(part || '').toLowerCase().includes(query.toLowerCase())));

// Standard answers as sections of questions (Settings → Profile → Standard answers), from the page's outline on any store: a section per
// heading; a question per table row [Question | Answer] or per "Question: answer" line ("**Question:** answer" on this Mac); any other line of a
// section is a note. A value that starts with ❓ is NOT SET: the ❓ is data (lib/questions.js lists those as "Answer once"), never shown; the
// words after it are the hint. Each item knows the change that writes it back (one cell, or one line with its own label kept). No DOM:
// guarded by test/answers-model.test.js.

const UNSET = /^\s*❓\s*/;
const ASKED = /\s*\(asked by ([^)]*)\)\s*$/;
// "**Question:** answer", "**Question?** answer", "Question: answer", "Question — answer": the label part kept as written.
const LABELLED = /^(\*\*(.+?)\*\*:?|([^:|]{1,90}?)(?::| —))(?:\s+|$)(.*)$/;
const plain = text => String(text).replace(/\*\*/g, '').replace(/[\s:*]+$/, '').replace(/^[\s*]+/, '').trim();

// "❓ to confirm — leave blank" → {open: true, hint: 'leave blank'}; "❓ (asked by Acme)" → {open, asked: 'Acme'}; "Leave blank" → {open: false}.
export function valueOf(raw) {
  const text = String(raw ?? '').trim();
  if (!UNSET.test(text)) return {open: false, optional: false, value: text, hint: '', asked: ''};
  const asked = text.match(ASKED)?.[1] || '';
  const hint = text.replace(UNSET, '').replace(ASKED, '').replace(/^\(|\)$/g, '').replace(/^(to confirm|optional)\s*[—:-]?\s*/i, '').trim();
  // "❓ optional": the drafting AI found nothing in the CV for it (GitHub, a portfolio): it stays on the page but is not "missing".
  return {open: true, optional: /^\s*❓\s*optional\b/i.test(text), value: '', hint, asked};
}

// "**Notice:** 3 months" → {head: '**Notice:**', question: 'Notice', raw: '3 months'}; a line with no label → null.
export function labelledLine(text) {
  const match = String(text).match(LABELLED);
  return match && plain(match[2] || match[3]) ? {head: match[1], question: plain(match[2] || match[3]), raw: match[4]} : null;
}
function lineItem(item) {
  const line = labelledLine(item.text);
  if (!line) return {id: item.id, kind: 'note', question: '', ...valueOf(item.text), text: item.text};
  return {id: item.id, kind: 'line', head: line.head, question: line.question, ...valueOf(line.raw), text: item.text};
}

// → [{title, after: the id a new question of this section is inserted after, items: [{id, kind: 'cell' | 'line' | 'note', question, value, open, hint, asked}]}]
export function sections(items) {
  const out = [];
  let current = null;
  const section = title => { current = {title, items: []}; out.push(current); return current; };
  const walk = (list, top = true) => {
    for (const item of list || []) {
      if (/^heading_/.test(item.type)) { section(plain(item.text) || item.text).after = item.id; continue; }
      const into = current || section('');
      if (top) into.after = item.id;   // where a question added to this section goes
      if (item.type === 'table') {
        for (const row of (item.rows || []).slice(item.header ? 1 : 0)) {
          const [question = '', answer = ''] = row.cells;
          if (question.trim()) into.items.push({id: row.id, kind: 'cell', question: plain(question.replace(/❓/g, '')), was: answer, ...valueOf(answer)});
        }
      } else if (item.text?.trim()) into.items.push(lineItem(item));
      if (item.children) walk(item.children, false);
    }
  };
  walk(items);
  return out.filter(each => each.items.length);
}

// The change that writes `value` for an item (an empty value makes it not set again: ❓ back where the answer goes).
export function changeFor(item, value) {
  const text = String(value ?? '').replace(/\s*\n\s*/g, ' ').trim();
  if (item.kind === 'cell') return {op: 'cell', id: item.id, index: 1, value: text || '❓', was: item.was};
  if (item.kind === 'line') return {op: 'text', id: item.id, value: `${item.head} ${text || '❓'}`, was: item.text};
  return {op: 'text', id: item.id, value: text, was: item.text};
}
// A question added by the person: a "Question: answer" line at the end of its section (after its last block), or of the page.
export const lineFor = (question, value) => `${String(question).replace(/[\s:]+$/, '').trim()}: ${String(value || '').trim() || '❓'}`;

export const matches = (item, {query = '', attention = false} = {}) => (!attention || item.open)
  && (!query || [item.question, item.value, item.hint].some(part => String(part || '').toLowerCase().includes(query.toLowerCase())));
// Shown text never carries the ❓ mark (owner, 16 Oct 2026): a sentence that mentions it says "not set".
export const shown = text => String(text ?? '').replace(/\s*❓\s*/g, ' not set ').replace(/\s+/g, ' ').trim();

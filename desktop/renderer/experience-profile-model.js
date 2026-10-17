// Profile → Experience: the Professional summary and Strengths (owner, 17 Oct 2026: "Experience already holds the career evidence used for tailoring.
// A compact summary and strengths section fits naturally above the roles. Show a short preview with Edit"). They are sections of the Profile page
// (docs/notion-profile-template.md "Summary (from CV)" and "Core skills"; a setup draft or a person may say "Strengths"), read from its outline
// on any store and written back block by block (lib/text-outline-handlers.js). No DOM: guarded by test/experience-profile.test.js.

// The two parts, and the headings the template and the setup draft give them (the app's own words; a page without one gets the heading on save).
export const PARTS = {
  summary: {title: 'Professional summary', heading: 'Summary (from CV)', match: /^(professional\s+)?summary\b|^about me\b/i, icon: 'user'},
  strengths: {title: 'Strengths', heading: 'Strengths', match: /^strengths?\b|^core skills\b|^key skills\b|^expertise\b/i, icon: 'zap'},
};
const bare = text => String(text || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

// outline → {summary: {headingId, lines: [{id, text}]} | null, strengths: ...}: the first section each heading names, its own lines (a table or a
// nested block stays where it is: shown as text, never written).
export function readParts(items) {
  const out = Object.fromEntries(Object.keys(PARTS).map(key => [key, null]));
  let current = null;
  for (const item of items || []) {
    if (/^heading_/.test(item.type)) {
      const key = Object.keys(PARTS).find(each => PARTS[each].match.test(bare(item.text)));
      current = key && !out[key] ? (out[key] = {headingId: item.id, lines: []}) : null;
      continue;
    }
    if (current && item.type !== 'table' && String(item.text || '').trim()) current.lines.push({id: item.id, text: item.text.trim()});
  }
  return out;
}

// The changes that turn a part's lines into `texts` (the person's edited lines, in order): changed lines rewritten, emptied lines removed, new
// lines inserted after the part's last line (or its heading); a part the page lacks: one 'section' change (heading + lines at the end).
export function changesFor(key, part, texts) {
  const wanted = (texts || []).map(text => String(text || '').replace(/\s*\n\s*/g, ' ').trim());
  if (!part) {
    const lines = wanted.filter(Boolean);
    return lines.length ? [{op: 'section', heading: PARTS[key].heading, lines}] : [];
  }
  const changes = [];
  let anchor = part.headingId;   // new lines go after the last line this save keeps, never after one it removes (a removed id is gone, or on this Mac is the next line)
  part.lines.forEach((line, i) => {
    const text = wanted[i] ?? '';
    if (!text) { changes.push({op: 'remove', id: line.id, was: line.text}); return; }
    anchor = line.id;
    if (text !== line.text) changes.push({op: 'text', id: line.id, value: text, was: line.text});
  });
  const added = wanted.slice(part.lines.length).filter(Boolean);
  if (added.length) changes.push({op: 'insert', after: anchor, lines: added});
  return changes;
}

// What the preview shows: the lines without list marks or bold, joined.
export const previewOf = part => (part?.lines || []).map(line => line.text.replace(/\*\*/g, '').replace(/^[-*•]\s*/, '')).join(' · ');

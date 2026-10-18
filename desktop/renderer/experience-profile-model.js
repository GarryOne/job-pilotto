// The Profile page's own sections, each on the tab its meaning belongs to (owner, 17 Oct 2026: "I'd split these fields by meaning"; "Experience
// already holds the career evidence used for tailoring. A compact summary and strengths section fits naturally above the roles. Show a short preview
// with Edit"): Experience = summary, strengths, education and any section the app does not know (under its own title); Your details = the voluntary
// survey answers. The role history stays on the page (prompts read it) but is drawn by the job cards, "What tailoring can draw on" (owner, 17 Oct
// 2026: "this is redundant. Just duplicating data"). A heading's "(…)" is its note; a deeper heading belongs to the section above it. Lines Strategy's Job preferences or Your details already edit are left out (one editor per value). Read from the
// page's outline on any store and written back block by block (lib/text-outline-handlers.js). No DOM: guarded by test/experience-profile.test.js.

import {readProfile} from './preferences-model.js';
import {isDetailsHeading} from './details-headings.js';

// The parts and the headings the template and the setup draft give them (docs/notion-profile-template.md; the app's own words).
export const PARTS = {
  summary: {title: 'Professional summary', heading: 'Summary (from CV)', match: /^(professional\s+)?summary\b|^about me\b/i, tab: 'experience'},
  strengths: {title: 'Strengths', heading: 'Strengths', match: /^strengths?\b|^core skills\b|^key skills\b|^expertise\b/i, tab: 'experience'},
  education: {title: 'Education', heading: 'Education', match: /^education\b/i, tab: 'experience'},
  roles: {title: 'Role history', heading: 'Experience', match: /^((work|professional)\s+)?experience$|^employment history\b|^role history\b/i, tab: 'job cards'},
  gaps: {title: 'Possible CV gaps', heading: 'CV gaps', match: /^(possible\s+)?cv\s+gaps?\b/i, tab: 'experience'},
  surveys: {title: 'Voluntary surveys', heading: 'Application form answers — voluntary demographic surveys', match: /demographic|voluntary survey/i, tab: 'details'},
};
// The template's explanations under its headings: instructions, not the person's words (shown nowhere).
const TEMPLATE_NOTES = [/^the ai scorer \(stage 2\) reads this page/i, /^jobs that break these are filtered out/i, /^optional\. only fill this in if you want/i];
const bare = text => String(text || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
// "Experience (full detail, verbatim from CV, added 25 Sep 2026)" → title "Experience", note "full detail, verbatim from CV, added 25 Sep 2026".
export function splitNote(heading) {
  const found = /^(.*?\S)\s*\(([^()]+)\)\s*$/.exec(bare(heading));
  return found ? {title: found[1], note: found[2].trim()} : {title: bare(heading), note: ''};
}
const levelOf = type => Number(String(type).slice(-1)) || 1;
const isHint = text => /^\s*❓/.test(String(text || ''));
export const unset = cell => !String(cell || '').trim() || isHint(cell);

// outline → {summary, strengths, education, roles, surveys: part | null, others: [part + {key, title}]}; part = {headingId, lines: [{id, text}],
// rows: [{id, cells}] (a table's), hints: [{id, text}] (the template's ❓ lines)}. elsewhere(heading) = a section another screen edits (left out);
// taken(id) = a line or row edited elsewhere (Strategy's fields and rules).
export function readParts(items, {elsewhere = () => false, taken = () => false} = {}) {
  const out = {...Object.fromEntries(Object.keys(PARTS).map(key => [key, null])), others: []};
  let current = null, level = 0;   // the section the lines go to, and the level of the known section's heading (0: none)
  for (const item of items || []) {
    if (/^heading_/.test(item.type)) {
      const {title, note} = splitNote(item.text), depth = levelOf(item.type);
      const key = Object.keys(PARTS).find(each => PARTS[each].match.test(title));
      if (key) { current = out[key] ? null : (out[key] = {headingId: item.id, note, lines: [], rows: [], hints: []}); level = depth; }
      else if (elsewhere(item.text)) { current = null; level = 0; }
      // A sub-heading of a known section (a role under Experience) keeps its lines there; under a page title or an unknown section it is its own.
      else if (level && depth > level) continue;
      else { out.others.push(current = {key: `section:${item.id}`, title, note, headingId: item.id, lines: [], rows: [], hints: []}); level = 0; }
      continue;
    }
    if (!current || taken(item.id)) continue;
    if (item.type === 'table') {
      for (const row of (item.rows || []).slice(item.header ? 1 : 0)) if (!taken(row.id) && row.cells.some(cell => !unset(cell))) current.rows.push({id: row.id, cells: row.cells});
      continue;
    }
    const text = String(item.text || '').trim();
    if (!text || TEMPLATE_NOTES.some(note => note.test(text))) continue;
    (isHint(text) ? current.hints : current.lines).push({id: item.id, text});
  }
  out.others = out.others.filter(part => part.lines.length || part.rows.length);
  return out;
}

// Remove when: no Profile page still has a Contact / Links section (Your details has moved them), not when installs update.
const LEGACY = /^(📇\s*)?(contact|links)$/i;   // older Profiles' Contact / Links sections: Your details reads them (lib/contact.js)
// The Profile's sections, without what other screens edit: Your details' sections and Strategy's fields and rules (preferences-model.js).
export function profileParts(items) {
  const read = readProfile(items);
  const taken = new Set([...Object.values(read.fields).filter(Boolean), ...read.other, ...(read.note ? [read.note] : [])].map(item => item.id));
  return readParts(items, {elsewhere: heading => isDetailsHeading(heading) || LEGACY.test(String(heading).trim()), taken: id => taken.has(id)});
}

export const partsOn = (parts, tab) => [...Object.keys(PARTS).filter(key => PARTS[key].tab === tab && (key !== 'gaps' || parts.gaps)).map(key => ({key, title: PARTS[key].title, part: parts[key]})),
  ...(tab === 'experience' ? parts.others.map(part => ({key: part.key, title: part.title, part})) : [])];

// The changes that turn a part's lines into `texts` (the person's edited lines, in order): changed lines rewritten, emptied lines removed, new
// lines after the last kept line (never after a removed one: on this Mac an id is a line number), or in place of the template's ❓ line, or after
// the heading; a part the page lacks: one 'section' change (heading + lines at the end). Rows: `cells` = the edited cells per row, in order.
export function changesFor(key, part, texts, cells = []) {
  const wanted = (texts || []).map(text => String(text || '').replace(/\s*\n\s*/g, ' ').trim());
  if (!part) {
    const lines = wanted.filter(Boolean);
    return lines.length && PARTS[key] ? [{op: 'section', heading: PARTS[key].heading, lines}] : [];
  }
  const changes = [];
  (part.rows || []).forEach((row, i) => row.cells.forEach((was, index) => {
    const value = String(cells[i]?.[index] ?? was).trim();
    if (value !== was && !(unset(was) && !value)) changes.push({op: 'cell', id: row.id, index, value, was});
  }));
  let anchor = part.hints?.[0]?.id ?? part.headingId;
  part.lines.forEach((line, i) => {
    const text = wanted[i] ?? '';
    if (!text) { changes.push({op: 'remove', id: line.id, was: line.text}); return; }
    anchor = line.id;
    if (text !== line.text) changes.push({op: 'text', id: line.id, value: text, was: line.text});
  });
  const added = wanted.slice(part.lines.length).filter(Boolean);
  if (added.length && !part.lines.length && part.hints?.length) {   // the template's ❓ line becomes the first line
    changes.push({op: 'text', id: part.hints[0].id, value: added.shift(), was: part.hints[0].text});
  }
  if (added.length) changes.push({op: 'insert', after: anchor, lines: added});
  return changes;
}

// Strengths as groups: "**Cloud:** AWS (ECS, EKS); Azure" → {label: 'Cloud', items: ['AWS (ECS, EKS)', 'Azure']} (split at commas and semicolons
// outside brackets); a line with no "Label:" → {label: '', items: [the line]}.
export function groupsOf(part) {
  return (part?.lines || []).map(line => {
    const text = shownText(line.text), found = /^([^:]{1,40}):\s+(.+)$/.exec(text);
    return found ? {label: found[1].trim(), items: splitItems(found[2])} : {label: '', items: [text]};
  });
}
// "AWS (ECS, EKS); Azure." → ['AWS (ECS, EKS)', 'Azure']: split at commas and semicolons outside brackets, a closing full stop dropped.
export function splitItems(text) {
  const items = [];
  let depth = 0, word = '';
  for (const char of String(text || '')) {
    depth += char === '(' ? 1 : char === ')' ? -1 : 0;
    if (depth === 0 && /[,;]/.test(char)) { items.push(word); word = ''; } else word += char;
  }
  items.push(word);
  return items.map(each => each.trim().replace(/\.$/, '')).filter(Boolean);
}
// A line's words on screen: no bold marks, no list mark, no ❓ (never a ❓ on screen); a line wholly in brackets is a note.
export const shownText = text => String(text || '').replace(/\*\*/g, '').replace(/^[-*•]\s*/, '').replace(/❓\s*/g, '').trim();
export const isNote = text => /^\(.*\)$/.test(String(text || '').trim());

// What the preview shows: the lines without list marks or bold, then the table's rows, joined.
export const previewOf = part => [...(part?.lines || []).map(line => line.text.replace(/\*\*/g, '').replace(/^[-*•]\s*/, '')),
  ...(part?.rows || []).map(row => row.cells.filter(cell => !unset(cell)).join(', '))].join(' · ');
export const isEmpty = part => !part || (!part.lines.length && !part.rows.length);

// Settings → Profile → Preferences (owner's mockup, 16 Oct 2026) from the Profile page's outline on any store: each known field (Countries, Work
// modes, Languages, Seniority…) found where the Profile keeps it (a table row "Label | value" or a "Label: value" line, in any section), drawn as
// its control; the other rows of the known sections (Hard constraints, Compensation, Preferences: profile-model.js kindOf) are "Other
// preferences"; every other line of the page is "The rest of your Profile". Values stay the free text the AI reads: a control only rewrites its
// own cell or line when the person changes it, and a field the page lacks is added as a "Label: value" line. ❓ = not set (answers-model.js).
// No DOM: guarded by test/preferences-model.test.js.
import {changeFor, labelledLine, valueOf} from './answers-model.js';
import {SUGGESTIONS, kindOf} from './profile-model.js';

export const GROUPS = {
  location: {title: 'Location & work style', lead: 'Where and how you want to work.', icon: 'pin'},
  languages: {title: 'Languages', lead: 'The languages you can work in, and your level.', icon: 'globe'},
  roles: {title: 'Roles & employment', lead: "The types of jobs you're interested in.", icon: 'briefcase'},
  pay: {title: 'Compensation', lead: 'Set currency, target and minimum.', icon: 'coins', folded: true},
  other: {title: 'Other preferences', lead: 'Industries, company size, on-call and anything else you set.', icon: 'sliders', folded: true},
};
export const LEVELS = ['Native', 'Fluent', 'Advanced (C1)', 'Upper intermediate (B2)', 'Intermediate (B1)', 'Basic (A2)', 'Beginner (A1)'];
export const MODES = ['On-site', 'Hybrid', 'Remote'];
// The Profile template's own rows (docs/notion-profile-template.md), by the words their label starts with; first match wins.
export const FIELDS = [
  {key: 'countries', label: 'Countries', match: /^countr/i, widget: 'chips', group: 'location', add: 'Add countries'},
  {key: 'home', label: 'Home base', match: /^home base|^current location/i, widget: 'text', group: 'location', placeholder: 'City or region'},
  {key: 'cities', label: 'Preferred cities', match: /cities|^places/i, widget: 'chips', group: 'location', add: 'Add a city'},
  {key: 'mode', label: 'Work modes', match: /^work mode/i, widget: 'modes', group: 'location'},
  {key: 'relocation', label: 'Relocation', match: /relocat/i, widget: 'select', options: ['Yes', 'No', 'Within my country'], group: 'location'},
  {key: 'permit', label: 'Work permit / visa', match: /permit|visa/i, widget: 'text', group: 'location'},
  {key: 'languages', label: 'Languages', match: /^languages/i, widget: 'languages', group: 'languages'},
  {key: 'roles', label: 'Role priorities', match: /^(target )?roles?\b|^role priorit/i, widget: 'chips', group: 'roles', add: 'Add a role'},
  {key: 'employment', label: 'Employment type', match: /^employment|^contract/i, widget: 'select', options: SUGGESTIONS['employment type'], group: 'roles'},
  {key: 'workload', label: 'Workload', match: /^workload/i, widget: 'workload', group: 'roles'},
  {key: 'seniority', label: 'Seniority', match: /seniority/i, widget: 'select', options: SUGGESTIONS['minimum seniority'], group: 'roles'},
  {key: 'target', label: 'Target', match: /^target(?! roles?)/i, widget: 'text', group: 'pay', placeholder: 'e.g. CHF 150k gross'},
  {key: 'minimum', label: 'Minimum acceptable', match: /^minimum (acceptable|salary)|^minimum$/i, widget: 'text', group: 'pay', placeholder: 'e.g. CHF 130k gross'},
];
export const fieldFor = label => FIELDS.find(field => field.match.test(String(label).trim())) || null;

// outline → {fields: {key: item | null}, other: [item], rest: [{heading} | item], anchor: id after which a missing field is added}
// item: {id, kind: 'cell' | 'line' | 'note', label, value, open, hint, was/head/text} (answers-model.js changeFor writes it back).
export function readProfile(items) {
  const fields = Object.fromEntries(FIELDS.map(field => [field.key, null]));
  const other = [], rest = [];
  let known = false, anchor = null;
  const take = (item, label) => {
    const field = fieldFor(label);
    if (field && !fields[field.key]) { fields[field.key] = {...item, label: field.label}; return true; }
    return false;
  };
  const walk = (list, top = true) => {
    for (const block of list || []) {
      if (/^heading_/.test(block.type)) {
        known = !!kindOf(block.text);
        if (known) anchor = block.id;
        rest.push({heading: block.text, known});
        continue;
      }
      if (known && top) anchor = block.id;
      if (block.type === 'table') {
        for (const row of (block.rows || []).slice(block.header ? 1 : 0)) {
          const [label = '', value = ''] = row.cells;
          if (!label.trim()) continue;
          const item = {id: row.id, kind: 'cell', label: label.replace(/\*\*/g, '').trim(), was: value, ...valueOf(value)};
          if (!take(item, item.label)) (known ? other : rest).push(item);
        }
      } else if (block.text?.trim()) {
        const line = labelledLine(block.text);
        const item = line ? {id: block.id, kind: 'line', head: line.head, label: line.question, text: block.text, ...valueOf(line.raw)}
          : {id: block.id, kind: 'note', label: '', text: block.text, ...valueOf(block.text)};
        if (!(line && take(item, line.question))) (known && line ? other : rest).push(item);
      }
      if (block.children) walk(block.children, false);
    }
  };
  walk(items);
  // Headings with nothing of their own left in the rest are not shown there.
  return {fields, other, rest: rest.filter((entry, i) => !entry.heading || (rest[i + 1] && !rest[i + 1].heading)), anchor};
}

// The change that writes a field: its own cell or line, or a new "Label: value" line after the known sections (or at the end of the page).
export function fieldChange(field, item, value, anchor) {
  if (item) return changeFor(item, value);
  const line = `${field.label}: ${String(value).trim() || '❓'}`;
  return anchor ? {op: 'insert', after: anchor, key: field.key, lines: [line]} : {op: 'append', key: field.key, lines: [line]};
}

// Chips: "Switzerland (anywhere), Germany; Austria" ↔ ['Switzerland (anywhere)', 'Germany', 'Austria'].
export const chipsOf = value => String(value || '').split(/\s*[,;]\s*/).map(part => part.trim()).filter(Boolean);
export const chipsText = list => list.join(', ');
// Languages: "English (fluent), German (B1)" ↔ [{name: 'English', level: 'fluent'}, …].
export const languagesOf = value => chipsOf(value).map(part => { const m = part.match(/^(.+?)\s*\((.+)\)\s*$/); return m ? {name: m[1].trim(), level: m[2].trim()} : {name: part, level: ''}; });
export const languagesText = list => list.filter(each => each.name.trim()).map(each => (each.level ? `${each.name.trim()} (${each.level})` : each.name.trim())).join(', ');
// Work modes: the modes a value names (its own words: "On-site, hybrid or remote") ↔ "Hybrid, Remote".
export const modesOf = value => MODES.filter(mode => new RegExp(mode === 'On-site' ? 'on-?site|office' : mode, 'i').test(String(value || '')));
export const modesText = list => MODES.filter(mode => list.includes(mode)).join(', ');
// Workload: "80–100%" ↔ {min: '80', max: '100'}; "100%" ↔ {min: '100', max: '100'}.
export function workloadOf(value) {
  const range = String(value || '').match(/(\d{1,3})\s*%?\s*[–-]\s*(\d{1,3})\s*%/), one = String(value || '').match(/(\d{1,3})\s*%/);
  return range ? {min: range[1], max: range[2]} : one ? {min: one[1], max: one[1]} : {min: '', max: ''};
}
export const workloadText = ({min, max}) => (!min && !max ? '' : min && max && min !== max ? `${min}–${max}%` : `${min || max}%`);

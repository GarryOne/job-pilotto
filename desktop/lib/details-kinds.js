// The typed controls of Your details' fact lines (owner, 17 Oct 2026: "Base facts fixed, AI the rest"; the tidy runs "on first open, with Undo"; a line it
// can't read with confidence "stays text + Check chip"). The AI judges each label's kind once (lib/question-formats.js; per country only in Work eligibility,
// language only in Languages) and may write a salary, notice period, range or language level in the kind's own wording, but the code checks every number and
// word against the original (renderer/question-values.js faithful): every number is kept once, in the value or in the note, and the note is copied word for word
// (owner, 17 Oct 2026: "The instruction-like prose goes into a note under the control, not into the value"). A rewrite that differs is refused and the line keeps its
// words with the kind's mark. A Languages line that lists several languages becomes one row per language with its level.
// Before any line changes both pages are copied and the backup runs (lib/profile-move.js saveCopy); after, every line is read back, else all go back; Undo
// restores the lines as they were. Works on every store (lib/store). Guarded by test/details-kinds.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import * as formats from './question-formats.js';
import * as sections from './profile-sections.js';
import {saveCopy} from './profile-move.js';
import {COMPOSITE} from '../renderer/question-kind.js';
import {LEVELS, NOTE_JOIN, canonical, faithful, hasNumber} from '../renderer/question-values.js';
import {keyOf} from '../renderer/question-filter.js';

export const COMPOSITE_KINDS = COMPOSITE;   // the kinds a saved line may carry
export const ALLOW = {eligibility: ['per_country'], availability: [], languages: ['language']};
const REWRITABLE = ['salary', 'duration', 'range', 'language'];   // a status per country or a link is read by code only
export const MODEL = 'claude-haiku-5-5';
const SCHEMA = {type: 'object', additionalProperties: false, required: ['items'], properties: {items: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['id', 'text', 'note'], properties: {id: {type: 'string'}, text: {type: 'string'}, note: {type: 'string'}}}}}};
const LANG_SCHEMA = {type: 'object', additionalProperties: false, required: ['items'], properties: {items: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['id', 'languages', 'note'], properties: {id: {type: 'string'}, note: {type: 'string'}, languages: {type: 'array', items: {type: 'object', additionalProperties: false,
    required: ['name', 'level'], properties: {name: {type: 'string'}, level: {type: 'string'}}}}}}}}};
const INSTRUCTIONS = `Each item is one line of a job seeker's profile, in any language, with the kind of answer it holds. Rewrite its value in the kind's own wording, keeping every number and
word it states; add nothing, guess nothing. When you are not sure, answer text "" and note "".
note: the parts of the line that are not the value itself (a remark, an instruction, a date it was confirmed, a word such as "Minimum"), each copied exactly as written and joined with " · "; "" when nothing is left over.
- "salary": <amount> <CURRENCY>/<hour|day|week|month|year> [net|gross]   e.g. "140000 CHF/year gross" (digits only in the amount; the currency as three capitals)
- "duration": <number> <day|week|month|year>[, ends at month-end]   e.g. "3 months", "1 month, ends at month-end"
- "range": <from>–<to> %   e.g. "50–100 %"
- "language": the level stated, one of A1 A2 B1 B2 C1 C2 native
Answer every id exactly as given.`;
const LANG_INSTRUCTIONS = `Each item is one line of a job seeker's profile, in any language, that may list the languages they speak. For each, list every language it states with the level it states
for that language: one of A1 A2 B1 B2 C1 C2 native (native for a mother tongue). Copy each language's name as written. note: what the line says besides those languages and levels
(for example the languages they do not speak), each part copied exactly as written and joined with " · "; "" when nothing is left over. When the line is not a list of languages and
levels, answer languages [] and note "". Answer every id exactly as given.`;

const labelsOf = (found, key) => found[key].filter(line => !line.kind).map(line => line.label);

// The kept kind of each unmarked label of the sections, judged once by the AI per label. -> {[keyOf(label)]: {kind, ...}}
export async function formatsOf(storage, found, ai = {}) {
  let latest = formats.kept(storage);
  for (const key of Object.keys(ALLOW)) {
    const labels = labelsOf(found, key);
    if (labels.length) latest = (await formats.ensure(storage, labels, {ai, allow: ALLOW[key]}).catch(() => ({formats: formats.kept(storage)}))).formats;
  }
  return latest;
}

// items [{id, kind, text}] -> Map(id -> {text, note}): the value in the kind's wording, and the words it does not hold. Only what the code read, or the AI wrote and the code found faithful.
export async function normalise(items, {client = null, apiKey = ''} = {}) {
  const out = new Map(), todo = [];
  for (const item of items) {
    const own = canonical(item.kind, item.text);
    if (own) out.set(item.id, {text: own, note: ''}); else if (REWRITABLE.includes(item.kind)) todo.push(item);
  }
  const ai = client || (apiKey ? anthropicApi(apiKey) : null);
  if (!ai || !todo.length) return out;
  const response = await ai.messages.create({model: MODEL, max_tokens: 4000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: JSON.stringify(todo.map(({id, kind, text}) => ({id, kind, line: text})))}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'}});
  let parsed = {};
  try { parsed = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}'); } catch { return out; }
  const byId = new Map(todo.map(item => [item.id, item]));
  for (const {id, text, note = ''} of Array.isArray(parsed.items) ? parsed.items : []) {
    const item = byId.get(id), said = typeof note === 'string' ? note.trim() : '';
    if (item && typeof text === 'string' && faithful(item.kind, item.text, text.trim(), said)) out.set(id, {text: canonical(item.kind, text.trim()), note: said});
  }
  return out;
}

// Lines of Languages that list several languages -> Map(id -> {rows: [{label, value}], note}). Every name must stand in the line, every level be on the scale and
// named by it, and the numbers (the digits of the levels, and of the note) must be those of the line: else the line is left as written.
export async function expandLanguages(items, {client = null, apiKey = ''} = {}) {
  const ai = client || (apiKey ? anthropicApi(apiKey) : null), out = new Map();
  if (!ai || !items.length) return out;
  const response = await ai.messages.create({model: MODEL, max_tokens: 4000, system: LANG_INSTRUCTIONS,
    messages: [{role: 'user', content: JSON.stringify(items.map(({id, text}) => ({id, line: text})))}],
    output_config: {format: {type: 'json_schema', schema: LANG_SCHEMA}, effort: 'low'}});
  let parsed = {};
  try { parsed = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}'); } catch { return out; }
  const byId = new Map(items.map(item => [item.id, item.text])), squash = text => String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  for (const {id, languages, note = ''} of Array.isArray(parsed.items) ? parsed.items : []) {
    const original = byId.get(id), said = typeof note === 'string' ? note.trim() : '';
    if (original === undefined || !Array.isArray(languages) || !languages.length) continue;
    const rows = languages.map(each => ({label: String(each?.name || '').trim(), value: LEVELS.find(level => level.toLowerCase() === String(each?.level || '').toLowerCase()) || ''}));
    const digits = text => (String(text).match(/\d/g) || []).sort().join('');
    const named = rows.every(row => row.label && row.value && squash(original).includes(squash(row.label)) && squash(original).includes(squash(row.value)));
    const pieces = said.split(NOTE_JOIN).map(squash).filter(Boolean);
    if (named && pieces.every(piece => squash(original).includes(piece)) && digits(original) === digits(rows.map(row => row.value).join('') + said)) out.set(id, {rows, note: said});
  }
  return out;
}

const plain = found => Object.fromEntries(Object.entries(found).map(([key, list]) => [key, list.map(line => ({...line}))]));

// The one tidy: lines whose kind is a base-fact kind get their mark, the value in the kind's wording and the rest in a note; a Languages line listing several
// languages becomes one row each. A line that is only a rule in words (no number to type) stays plain text. -> {changed, copy}.
// ai: {client, apiKey}; none: nothing changes and it is tried again. copy/save: a test passes its own.
export async function tidy(storage, {fetcher, ai = {}, copy = saveCopy, save = sections.save, now = new Date()} = {}) {
  if (storage.settings().detailsKindsAt) return {changed: 0};
  if (!ai.client && !ai.apiKey) return {changed: 0};
  const found = await sections.read(storage, fetcher), kept = await formatsOf(storage, found, ai);
  const typed = [], listed = [];
  for (const key of Object.keys(ALLOW)) {
    for (const line of found[key]) {
      if (line.kind) continue;
      const id = `${key}:${line.label}`;
      if (key === 'languages') {
        if (canonical('language', line.value)) typed.push({id, key, line, kind: 'language'}); else if (line.value) listed.push({id, key, line});
        continue;
      }
      const kind = kept[keyOf(line.label)]?.kind;
      if (!COMPOSITE.includes(kind) || ['language'].includes(kind) || (kind === 'per_country' && !ALLOW[key].includes(kind))) continue;
      if (['salary', 'duration', 'range'].includes(kind) && !canonical(kind, line.value) && !hasNumber(line.value)) continue;   // a rule in words: nothing to type
      typed.push({id, key, line, kind});
    }
  }
  const wording = await normalise(typed.map(each => ({id: each.id, kind: each.kind, text: each.line.value})), ai);
  const split = await expandLanguages(listed.map(each => ({id: each.id, text: each.line.value})), ai);
  const changes = [
    ...typed.map(each => ({...each, rows: [{label: each.line.label, value: wording.get(each.id)?.text || each.line.value, kind: each.kind, ...(wording.get(each.id)?.note ? {note: wording.get(each.id).note} : {})}]})),
    ...listed.filter(each => split.has(each.id)).map(each => {
      const {rows, note} = split.get(each.id);
      return {...each, rows: [...rows.map(row => ({...row, kind: 'language'})), ...(note ? [{label: `${each.line.label} (note)`, value: note, kind: ''}] : [])]};
    }),
  ];
  if (!changes.length) { storage.saveSettings({detailsKindsAt: now.toISOString()}); return {changed: 0}; }
  const kept_ = await copy(storage, {fetcher, now});
  const before = plain(found);
  const next = key => found[key].flatMap(line => changes.find(each => each.key === key && each.line === line)?.rows || [line]);
  try {
    for (const key of Object.keys(ALLOW)) if (changes.some(each => each.key === key)) await save(storage, key, next(key), fetcher);
    const written = await sections.read(storage, fetcher);
    const bad = changes.flatMap(each => each.rows.map(row => ({key: each.key, row}))).filter(({key, row}) => !written[key].some(line => line.label === row.label && line.value === row.value && (line.kind || '') === (row.kind || '') && (line.note || '') === (row.note || '')));
    if (bad.length) throw new Error(`Your details tidy: ${bad.length} line(s) did not save; nothing was removed (the pages before it are in ${kept_.dir})`);
  } catch (error) {
    for (const key of Object.keys(ALLOW)) await sections.save(storage, key, before[key], fetcher).catch(() => {});
    throw error;
  }
  storage.saveSettings({detailsKindsAt: now.toISOString(), detailsTidy: {at: now.toISOString(), dir: kept_.dir, changed: changes.length, before}});
  return {changed: changes.length, copy: kept_};
}

// Undo: the lines as they were before the tidy. It is not tidied again.
export async function undo(storage, {fetcher, save = sections.save} = {}) {
  const done = storage.settings().detailsTidy;
  if (!done?.before || done.undone) return {ok: false, error: 'There is nothing to undo'};
  for (const key of Object.keys(ALLOW)) await save(storage, key, done.before[key] || [], fetcher);
  storage.saveSettings({detailsTidy: {...done, before: undefined, undone: true}});
  return {ok: true};
}

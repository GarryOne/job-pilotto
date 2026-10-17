// The typed controls of Your details' fact lines (owner, 17 Oct 2026: "Base facts fixed, AI the rest"; the tidy runs "on first open, with Undo"; a line it
// can't read with confidence "stays text + Check chip"). The AI judges each label's kind once (lib/question-formats.js; per country only in Work eligibility,
// language only in Languages) and may write a salary, notice period, range or language level in the kind's own wording, but the code checks every number and
// word against the original (renderer/question-values.js faithful): a rewrite that differs is refused and the line keeps its words with the kind's mark.
// Before any line changes both pages are copied and the backup runs (lib/profile-move.js saveCopy); after, every line is read back, else all go back; Undo
// restores the lines as they were. Works on every store (lib/store). Guarded by test/details-kinds.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import * as formats from './question-formats.js';
import * as sections from './profile-sections.js';
import {saveCopy} from './profile-move.js';
import {COMPOSITE} from '../renderer/question-kind.js';
import {canonical, faithful} from '../renderer/question-values.js';
import {keyOf} from '../renderer/question-filter.js';

export const COMPOSITE_KINDS = COMPOSITE;   // the kinds a saved line may carry
export const ALLOW = {eligibility: ['per_country'], availability: [], languages: ['language']};
const REWRITABLE = ['salary', 'duration', 'range', 'language'];   // a status per country or a link is read by code only
export const MODEL = 'claude-haiku-5-5';
const SCHEMA = {type: 'object', additionalProperties: false, required: ['items'], properties: {items: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['id', 'text'], properties: {id: {type: 'string'}, text: {type: 'string'}}}}}};
const INSTRUCTIONS = `Each item is one line of a job seeker's profile, in any language, with the kind of answer it holds. Rewrite its value in the kind's own wording, keeping every number and
word it states; add nothing, guess nothing. When you are not sure, answer "".
- "salary": <amount> <CURRENCY>/<hour|day|week|month|year> [net|gross]   e.g. "140000 CHF/year gross" (digits only in the amount; the currency as three capitals)
- "duration": <number> <day|week|month|year>[, ends at month-end]   e.g. "3 months", "1 month, ends at month-end"
- "range": <from>–<to> %   e.g. "50–100 %"
- "language": the level stated, one of A1 A2 B1 B2 C1 C2 native
Answer every id exactly as given.`;

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

// items [{id, kind, text}] -> Map(id -> the text in the kind's wording): only what the code read, or the AI wrote and the code found faithful.
export async function normalise(items, {client = null, apiKey = ''} = {}) {
  const out = new Map(), todo = [];
  for (const item of items) {
    const own = canonical(item.kind, item.text);
    if (own) out.set(item.id, own); else if (REWRITABLE.includes(item.kind)) todo.push(item);
  }
  const ai = client || (apiKey ? anthropicApi(apiKey) : null);
  if (!ai || !todo.length) return out;
  const response = await ai.messages.create({model: MODEL, max_tokens: 4000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: JSON.stringify(todo.map(({id, kind, text}) => ({id, kind, line: text})))}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'}});
  let parsed = {};
  try { parsed = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}'); } catch { return out; }
  const byId = new Map(todo.map(item => [item.id, item]));
  for (const {id, text} of Array.isArray(parsed.items) ? parsed.items : []) {
    const item = byId.get(id);
    if (item && typeof text === 'string' && faithful(item.kind, item.text, text.trim())) out.set(id, canonical(item.kind, text.trim()));
  }
  return out;
}

const plain = found => Object.fromEntries(Object.entries(found).map(([key, list]) => [key, list.map(line => ({...line}))]));

// The one tidy: lines whose kind is a base-fact kind get their mark, and the value in the kind's wording when it is faithful. -> {changed, copy}.
// ai: {client, apiKey}; none: nothing changes and it is tried again. copy/save: a test passes its own.
export async function tidy(storage, {fetcher, ai = {}, copy = saveCopy, save = sections.save, now = new Date()} = {}) {
  if (storage.settings().detailsKindsAt) return {changed: 0};
  if (!ai.client && !ai.apiKey) return {changed: 0};
  const found = await sections.read(storage, fetcher), kept = await formatsOf(storage, found, ai);
  const plan = [];
  for (const key of Object.keys(ALLOW)) {
    for (const line of found[key]) {
      const kind = line.kind || kept[keyOf(line.label)]?.kind;
      if (!line.kind && COMPOSITE.includes(kind) && (ALLOW[key].includes(kind) || !['per_country', 'language'].includes(kind))) plan.push({id: `${key}:${line.label}`, key, line, kind});
    }
  }
  const wording = await normalise(plan.map(each => ({id: each.id, kind: each.kind, text: each.line.value})), ai);
  const changes = plan.map(each => ({...each, value: wording.get(each.id) || each.line.value}));
  if (!changes.length) { storage.saveSettings({detailsKindsAt: now.toISOString()}); return {changed: 0}; }
  const kept_ = await copy(storage, {fetcher, now});
  const before = plain(found);
  const next = key => found[key].map(line => {
    const change = changes.find(each => each.key === key && each.line === line);
    return change ? {label: line.label, value: change.value, kind: change.kind} : line;
  });
  try {
    for (const key of Object.keys(ALLOW)) if (changes.some(each => each.key === key)) await save(storage, key, next(key), fetcher);
    const written = await sections.read(storage, fetcher);
    const bad = changes.filter(each => !written[each.key].some(line => line.label === each.line.label && line.value === each.value && line.kind === each.kind));
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

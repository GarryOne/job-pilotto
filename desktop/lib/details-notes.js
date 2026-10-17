// A long Your details line whose value holds rules for the AI (owner, 18 Oct 2026: "Apply your 'Folded Note for the AI' decision there too": a Work eligibility
// line of ~800 characters, an Availability "Target… Treat as a target" line) gets its fact as the value and the rest as its note, once per install. The AI only
// splits; the code checks the value and each note part are copied from the line and that every word of the line is kept, exactly once (faithfulSplit): else the
// line keeps its words. Same safety as the kinds tidy (lib/details-kinds.js): copy and backup first, every line read back, else all go back, and the one Undo
// restores the lines as they were. Guarded by test/details-note-fold.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import * as sections from './profile-sections.js';
import {saveCopy} from './profile-move.js';
import {ALLOW, MODEL} from './details-kinds.js';
import {NOTE_JOIN} from '../renderer/question-values.js';

export const LONG = 80;   // characters: a value longer than this may hold more than the fact
const SCHEMA = {type: 'object', additionalProperties: false, required: ['items'], properties: {items: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['id', 'value', 'note'], properties: {id: {type: 'string'}, value: {type: 'string'}, note: {type: 'string'}}}}}};
const INSTRUCTIONS = `Each item is one line of a job seeker's profile (its label and its value), in any language. Split the value in two:
value: the fact itself, the short answer a form would take (for example the permit, the amount, the date), copied exactly as written;
note: everything else (an instruction, a rule, a reason, how to score or answer), each part copied exactly as written and joined with " · ".
Change no word, add none, drop none: value and note together hold every word of the line. When the whole value is the fact, answer value "" and note "".
Answer every id exactly as given.`;

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const words = text => (squash(text).match(/[\p{L}\p{N}]+/gu) || []).sort().join(' ');

// The value and every note part stand in the line as written, and the line's words are those of value + note, each once.
export function faithfulSplit(original, value, note) {
  const pieces = String(note ?? '').split(NOTE_JOIN).map(squash).filter(Boolean);
  if (!squash(value) || !pieces.length || !squash(original).includes(squash(value))) return false;
  return pieces.every(piece => squash(original).includes(piece)) && words(original) === words(`${value} ${pieces.join(' ')}`);
}

// items [{id, label, text}] -> Map(id -> {value, note}): only the splits the code found faithful.
export async function splitLines(items, {client = null, apiKey = ''} = {}) {
  const ai = client || (apiKey ? anthropicApi(apiKey) : null), out = new Map();
  if (!ai || !items.length) return out;
  const response = await ai.messages.create({model: MODEL, max_tokens: 4000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: JSON.stringify(items.map(({id, label, text}) => ({id, label, value: text})))}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'}});
  let parsed = {};
  try { parsed = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}'); } catch { return out; }
  const byId = new Map(items.map(item => [item.id, item.text]));
  for (const {id, value, note} of Array.isArray(parsed.items) ? parsed.items : []) {
    const original = byId.get(id);
    if (original !== undefined && typeof value === 'string' && typeof note === 'string' && faithfulSplit(original, value, note)) out.set(id, {value: value.trim(), note: note.trim()});
  }
  return out;
}

const plain = found => Object.fromEntries(Object.entries(found).map(([key, list]) => [key, list.map(line => ({...line}))]));

// The one split, after the kinds tidy. ai: {client, apiKey}; none: nothing changes and it is tried again. copy/save: a test passes its own. -> {changed, copy}.
export async function split(storage, {fetcher, ai = {}, copy = saveCopy, save = sections.save, now = new Date()} = {}) {
  if (storage.settings().detailsNotesAt) return {changed: 0};
  if (!ai.client && !ai.apiKey) return {changed: 0};
  const found = await sections.read(storage, fetcher);
  const long = Object.keys(ALLOW).flatMap(key => found[key].filter(line => !line.note && String(line.value).length > LONG).map(line => ({id: `${key}:${line.label}`, key, line})));
  const done = await splitLines(long.map(each => ({id: each.id, label: each.line.label, text: each.line.value})), ai);
  const changes = long.filter(each => done.has(each.id)).map(each => ({...each, row: {...each.line, ...done.get(each.id)}}));
  if (!changes.length) { storage.saveSettings({detailsNotesAt: now.toISOString()}); return {changed: 0}; }
  const kept = await copy(storage, {fetcher, now});
  const before = plain(found);
  try {
    for (const key of Object.keys(ALLOW)) if (changes.some(each => each.key === key)) await save(storage, key, found[key].map(line => changes.find(each => each.line === line)?.row || line), fetcher);
    const written = await sections.read(storage, fetcher);
    const bad = changes.filter(({key, row}) => !written[key].some(line => line.label === row.label && line.value === row.value && (line.note || '') === row.note && (line.kind || '') === (row.kind || '')));
    if (bad.length) throw new Error(`Your details notes: ${bad.length} line(s) did not save; nothing was removed (the pages before it are in ${kept.dir})`);
  } catch (error) {
    for (const key of Object.keys(ALLOW)) await sections.save(storage, key, before[key], fetcher).catch(() => {});
    throw error;
  }
  // One Undo for both passes: it gives back the lines from before the first one still live.
  const tidy = storage.settings().detailsTidy, live = tidy?.before && !tidy.undone;
  storage.saveSettings({detailsNotesAt: now.toISOString(),
    detailsTidy: live ? {...tidy, at: now.toISOString(), changed: tidy.changed + changes.length} : {at: now.toISOString(), dir: kept.dir, changed: changes.length, before}});
  return {changed: changes.length, copy: kept};
}

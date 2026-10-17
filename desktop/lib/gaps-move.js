// The Profile's "Possible CV gaps" paragraph becomes one line per gap, on first open, with Undo (owner, 17 Oct 2026, review M7). The AI splits each paragraph into its gaps and the words
// besides them (a note to the person); the code checks every gap and note piece stands in the paragraph word for word and no digit is lost, else the paragraph stays as written. The pages are
// copied and backed up first, every new line is read back, else the paragraph is put back; Undo does the same. Works on every store (lib/store). Guarded by test/gaps-move.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import {saveCopy} from './profile-move.js';
import {applyEdits} from './text-outline-handlers.js';
import * as store from './store/index.js';
import {lineOf, readLine} from '../renderer/gaps-model.js';
import {profileParts} from '../renderer/experience-profile-model.js';
import {NOTE_JOIN} from '../renderer/question-values.js';

export const MODEL = 'claude-haiku-5-5';
const SCHEMA = {type: 'object', additionalProperties: false, required: ['items'], properties: {items: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['id', 'gaps', 'note'], properties: {id: {type: 'string'}, gaps: {type: 'array', items: {type: 'string'}}, note: {type: 'string'}}}}}};
const INSTRUCTIONS = `Each item is one line of a job seeker's profile, in any language, from the section "Possible CV gaps": skills or experience a job may ask for that the CV does not show, written as one run-on paragraph.
List each gap as its own short item, copied exactly as written (never reworded, never merged). note: whatever else the line says (a request to the person, a remark), each part copied exactly as written and joined with " · "; "" when nothing is left.
When the line is not a list of gaps, answer gaps [] and note "". Answer every id exactly as given.`;
const squash = text => String(text).replace(/\s+/g, ' ').trim().toLowerCase();
const digits = text => (String(text).match(/\d/g) || []).sort().join('');

// items [{id, text}] -> Map(id -> {gaps, note}): only what the AI said and the code found faithful.
export async function plan(items, {client = null, apiKey = ''} = {}) {
  const ai = client || (apiKey ? anthropicApi(apiKey) : null), out = new Map();
  if (!ai || !items.length) return out;
  const response = await ai.messages.create({model: MODEL, max_tokens: 4000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: JSON.stringify(items.map(({id, text}) => ({id, line: text})))}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'}});
  let parsed = {};
  try { parsed = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}'); } catch { return out; }
  const byId = new Map(items.map(item => [item.id, item.text]));
  for (const said of Array.isArray(parsed.items) ? parsed.items : []) {
    const original = byId.get(said?.id), note = typeof said?.note === 'string' ? said.note.trim() : '';
    const gaps = [...new Set((Array.isArray(said?.gaps) ? said.gaps : []).map(gap => String(gap || '').trim()).filter(Boolean))];
    if (original === undefined || !gaps.length) continue;
    const whole = squash(original), pieces = note.split(NOTE_JOIN).map(squash).filter(Boolean);
    if (gaps.every(gap => whole.includes(squash(gap))) && pieces.every(piece => whole.includes(piece)) && digits(original) === digits(gaps.join('') + note)) out.set(said.id, {gaps, note});
  }
  return out;
}

const linesOf = async it => (profileParts(await it.page('profile').outline()).gaps?.lines || []);
// Puts paragraphs back: the first new line of each takes the original text again, the others are removed. entries: [{original, texts}]
async function restore(it, entries) {
  const lines = await linesOf(it), changes = [];
  for (const {original, texts} of entries) {
    const first = lines.find(line => line.text === texts[0]);
    if (first) changes.push({op: 'text', id: first.id, value: original});
    for (const text of texts.slice(1)) { const found = lines.find(line => line.text === text); if (found) changes.push({op: 'remove', id: found.id}); }
  }
  if (changes.length) await applyEdits(it.page('profile'), await it.page('profile').outline(), changes);
}

// The one move. -> {changed, copy}. ai: {client, apiKey}; none: nothing changes and it is tried again. copy/now: a test passes its own.
export async function migrate(storage, {fetcher, ai = {}, copy = saveCopy, now = new Date()} = {}) {
  if (storage.settings().gapsMovedAt || (!ai.client && !ai.apiKey)) return {changed: 0};
  const it = store.openStore(storage, {fetcher}), lines = await linesOf(it);
  const todo = lines.map((line, i) => ({id: String(i), text: line.text.replace(/\*\*/g, '').replace(/^[-*•]\s*/, '').trim(), line})).filter(each => each.text && !readLine(each.text));
  const planned = await plan(todo, ai);
  const moves = todo.filter(each => planned.has(each.id)).map(each => {
    const {gaps, note} = planned.get(each.id);
    return {line: each.line, texts: [...gaps.map(gap => lineOf(gap, 'check')), ...(note ? [note] : [])]};
  });
  if (!moves.length) { storage.saveSettings({gapsMovedAt: now.toISOString()}); return {changed: 0}; }
  const kept = await copy(storage, {fetcher, now});
  const entries = moves.map(move => ({original: move.line.text, texts: move.texts}));
  try {
    const changes = moves.flatMap(move => [{op: 'text', id: move.line.id, value: move.texts[0], was: move.line.text}, ...(move.texts.length > 1 ? [{op: 'insert', after: move.line.id, lines: move.texts.slice(1)}] : [])]);
    const {missing} = await applyEdits(it.page('profile'), await it.page('profile').outline(), changes);
    const written = (await linesOf(it)).map(line => line.text.replace(/\*\*/g, '').replace(/^[-*•]\s*/, '').trim());
    if (missing.length || !moves.every(move => move.texts.every(text => written.includes(text)))) throw new Error(`The CV gaps: some lines did not save; the paragraph was put back (the pages before it are in ${kept.dir})`);
  } catch (error) {
    await restore(it, entries).catch(() => {});
    throw error;
  }
  storage.saveSettings({gapsMovedAt: now.toISOString(), gapsTidy: {at: now.toISOString(), dir: kept.dir, changed: moves.length, before: entries}});
  return {changed: moves.length, copy: kept};
}

// Undo: the paragraphs as they were. Not moved again.
export async function undo(storage, {fetcher} = {}) {
  const done = storage.settings().gapsTidy;
  if (!done?.before || done.undone) return {ok: false, error: 'There is nothing to undo'};
  await restore(store.openStore(storage, {fetcher}), done.before);
  storage.saveSettings({gapsTidy: {...done, before: undefined, undone: true}});
  return {ok: true};
}

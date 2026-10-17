// The voluntary survey bullets of the Profile become fixed questions with fixed lists, on first open, with Undo (owner, 17 Oct 2026, decisions A and B: "Fixed lists + Decline").
// The AI maps each bullet that is not yet an answer to a question and a choice from renderer/survey-model.js; the code writes the line itself and checks it against the bullet:
// the choice is on the question's list, the note is copied word for word from the bullet, every digit is kept, and one question answered twice is trusted for neither.
// A bullet that is no survey question stays as written; an instruction for the AI becomes a "Notes for the AI" line. The pages are copied and backed up first, every line is read
// back, else all go back; Undo restores the bullets. Works on every store (lib/store). Guarded by test/survey-move.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import {saveCopy} from './profile-move.js';
import {applyEdits} from './text-outline-handlers.js';
import * as store from './store/index.js';
import {SURVEYS, lineOf, noteLine, readLine, survey} from '../renderer/survey-model.js';
import {profileParts} from '../renderer/experience-profile-model.js';
import {NOTE_JOIN} from '../renderer/question-values.js';

export const MODEL = 'claude-haiku-5-5';
const SCHEMA = {type: 'object', additionalProperties: false, required: ['items'], properties: {items: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['id', 'kind', 'question', 'option', 'note'], properties: {id: {type: 'string'}, kind: {type: 'string', enum: ['answer', 'notes', 'keep']}, question: {type: 'string', enum: ['', ...SURVEYS.map(each => each.key)]},
    option: {type: 'string'}, note: {type: 'string'}}}}}};
const INSTRUCTIONS = `Each item is one line of a job seeker's profile, in any language, from the section of voluntary demographic survey answers they give on application forms.
kind "answer": the line states the person's answer to one of these questions; question is its key, option is exactly one choice from that question's list (use the Decline choice when they decline), note is whatever else the line says about it
(an instruction, a date it was confirmed, which label to use), each part copied exactly as written and joined with " · "; "" when nothing is left over.
kind "notes": an instruction or remark for the AI that fills forms, about the survey in general (not one answer). kind "keep": anything else, or when you are not sure.
Never guess an answer the line does not state.
${SURVEYS.map(each => `- ${each.key}: ${each.label}; choices: ${each.options.join(' | ')}`).join('\n')}
Answer every id exactly as given.`;
const squash = text => String(text).replace(/\s+/g, ' ').trim().toLowerCase();
const digits = text => (String(text).match(/\d/g) || []).sort().join('');

// items [{id, text}] -> Map(id -> new line text). Only what the AI said and the code found faithful.
export async function plan(items, taken, {client = null, apiKey = ''} = {}) {
  const ai = client || (apiKey ? anthropicApi(apiKey) : null), out = new Map();
  if (!ai || !items.length) return out;
  const response = await ai.messages.create({model: MODEL, max_tokens: 4000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: JSON.stringify(items.map(({id, text}) => ({id, line: text})))}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'}});
  let parsed = {};
  try { parsed = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}'); } catch { return out; }
  const byId = new Map(items.map(item => [item.id, item.text])), answers = new Map();
  for (const said of Array.isArray(parsed.items) ? parsed.items : []) {
    const original = byId.get(said?.id);
    if (original === undefined) continue;
    if (said.kind === 'notes') { out.set(said.id, noteLine(original)); continue; }
    const found = said.kind === 'answer' ? survey(said.question) : null, option = found?.options.find(each => each.toLowerCase() === String(said.option || '').toLowerCase());
    const note = typeof said.note === 'string' ? said.note.trim() : '';
    if (!option || !note.split(NOTE_JOIN).map(squash).filter(Boolean).every(piece => squash(original).includes(piece)) || digits(original) !== digits(option + note)) continue;
    answers.set(said.question, [...(answers.get(said.question) || []), said.id]);
    out.set(said.id, lineOf(said.question, option, note));
  }
  for (const [key, ids] of answers) if (ids.length > 1 || taken.has(key)) ids.forEach(id => out.delete(id));
  return out;
}

const linesOf = async it => (profileParts(await it.page('profile').outline()).surveys?.lines || []);

// The one move. -> {changed, copy}. ai: {client, apiKey}; none: nothing changes and it is tried again. copy/now: a test passes its own.
export async function migrate(storage, {fetcher, ai = {}, copy = saveCopy, now = new Date()} = {}) {
  if (storage.settings().surveyMovedAt || (!ai.client && !ai.apiKey)) return {changed: 0};
  const it = store.openStore(storage, {fetcher}), lines = await linesOf(it);
  const read = lines.map(line => ({line, read: readLine(line.text)}));
  const todo = read.filter(each => each.read.type === 'other').map(each => ({id: String(lines.indexOf(each.line)), text: each.read.text, line: each.line}));
  const taken = new Set(read.filter(each => each.read.type === 'answer').map(each => each.read.key));
  const planned = await plan(todo, taken, ai);
  const changes = todo.filter(each => planned.has(each.id)).map(each => ({op: 'text', id: each.line.id, value: planned.get(each.id), was: each.line.text}));
  if (!changes.length) { storage.saveSettings({surveyMovedAt: now.toISOString()}); return {changed: 0}; }
  const kept = await copy(storage, {fetcher, now});
  const undoAll = changes.map(change => ({op: 'text', id: change.id, value: change.was}));
  try {
    const {missing} = await applyEdits(it.page('profile'), await it.page('profile').outline(), changes);
    const written = (await linesOf(it)).map(line => line.text);
    if (missing.length || !changes.every(change => written.includes(change.value))) throw new Error(`The survey answers: some lines did not save; nothing was removed (the pages before it are in ${kept.dir})`);
  } catch (error) {
    await applyEdits(it.page('profile'), await it.page('profile').outline(), undoAll).catch(() => {});
    throw error;
  }
  storage.saveSettings({surveyMovedAt: now.toISOString(), surveyTidy: {at: now.toISOString(), dir: kept.dir, changed: changes.length, before: changes.map(change => ({value: change.value, was: change.was}))}});
  return {changed: changes.length, copy: kept};
}

// Undo: the bullets as they were. Not moved again.
export async function undo(storage, {fetcher} = {}) {
  const done = storage.settings().surveyTidy;
  if (!done?.before || done.undone) return {ok: false, error: 'There is nothing to undo'};
  const it = store.openStore(storage, {fetcher}), lines = await linesOf(it);
  const changes = done.before.map(each => ({op: 'text', id: lines.find(line => line.text === each.value)?.id, value: each.was})).filter(change => change.id !== undefined);
  await applyEdits(it.page('profile'), await it.page('profile').outline(), changes);
  storage.saveSettings({surveyTidy: {...done, before: undefined, undone: true}});
  return {ok: true};
}

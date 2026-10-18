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
const TRIES = 3;
const SCHEMA = {type: 'object', additionalProperties: false, required: ['items'], properties: {items: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['id', 'kind', 'question', 'option', 'note'], properties: {id: {type: 'string'}, kind: {type: 'string', enum: ['answer', 'notes', 'keep']}, question: {type: 'string', enum: ['', ...SURVEYS.map(each => each.key)]},
    option: {type: 'string'}, note: {type: 'string'}}}}}};
const INSTRUCTIONS = `Each item is one line of a job seeker's profile, in any language, from the section of voluntary demographic survey answers they give on application forms.
kind "answer": the line states the person's answer to one of these questions; question is its key, option is exactly one choice from that question's list (use the Decline choice when they decline), note is whatever else the line says about it
(an instruction, a date it was confirmed, which label to use), each part copied exactly as written (without surrounding brackets) and joined with " · "; leave out words that only restate the question, the choice or "Yes/No"; "" when nothing is left over.
kind "notes": an instruction or remark for the AI that fills forms, about the survey in general (not one answer). kind "keep": anything else, or when you are not sure.
A line that answers two questions (e.g. race and "Hispanic or Latino?") gets one item per answer, each with the same id; split its note between them, every part copied exactly.
Never guess an answer the line does not state.
${SURVEYS.map(each => `- ${each.key}: ${each.label}; choices: ${each.options.join(' | ')}`).join('\n')}
Answer every id exactly as given (a repeated id is allowed only for a line with several answers).`;
const squash = text => String(text).replace(/\s+/g, ' ').trim().toLowerCase();
const digits = text => (String(text).match(/\d/g) || []).sort().join('');

// items [{id, text}] -> Map(id -> [new line texts]): the first replaces the bullet, any more are added after it (a bullet that holds two answers, e.g. race and "Hispanic or Latino?",
// becomes one line each). Only what the AI said and the code found faithful: every choice is on its question's list, every note is copied from the bullet, all the digits of the bullet
// are kept across the lines, and one question answered twice is trusted for neither.
export async function plan(items, taken, {client = null, apiKey = ''} = {}) {
  const ai = client || (apiKey ? anthropicApi(apiKey) : null), out = new Map();
  if (!ai || !items.length) return out;
  const response = await ai.messages.create({model: MODEL, max_tokens: 4000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: JSON.stringify(items.map(({id, text}) => ({id, line: text})))}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'}});
  let parsed = {};
  try { parsed = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}'); } catch { return out; }
  const byId = new Map(items.map(item => [item.id, item.text])), said = new Map();
  for (const each of Array.isArray(parsed.items) ? parsed.items : []) if (byId.has(each?.id)) said.set(each.id, [...(said.get(each.id) || []), each]);
  const answers = new Map();
  for (const [id, entries] of said) {
    const original = byId.get(id);
    if (entries[0].kind === 'notes') { out.set(id, [noteLine(original)]); continue; }
    const picked = entries.map(entry => {
      const found = entry.kind === 'answer' ? survey(entry.question) : null, option = found?.options.find(each => each.toLowerCase() === String(entry.option || '').toLowerCase());
      return {question: entry.question, option, note: typeof entry.note === 'string' ? entry.note.trim() : ''};
    });
    if (!picked.every(each => each.option) || new Set(picked.map(each => each.question)).size !== picked.length) continue;
    const notesOk = picked.every(each => each.note.split(NOTE_JOIN).map(squash).filter(Boolean).every(piece => squash(original).includes(piece)));
    if (!notesOk || digits(original) !== digits(picked.map(each => each.option + each.note).join(''))) continue;
    for (const each of picked) answers.set(each.question, [...(answers.get(each.question) || []), id]);
    out.set(id, picked.map(each => lineOf(each.question, each.option, each.note)));
  }
  for (const [key, ids] of answers) if (ids.length > 1 || taken.has(key)) ids.forEach(id => out.delete(id));
  return out;
}

const linesOf = async it => (profileParts(await it.page('profile').outline()).surveys?.lines || []);

// The one move. -> {changed, copy, reason}: reason (a word, never a value) says why nothing changed while lines were waiting. ai: {client, apiKey}; none: nothing changes and it is tried again. copy/now: a test passes its own.
export async function migrate(storage, {fetcher, ai = {}, copy = saveCopy, now = new Date()} = {}) {
  const {surveyMovedAt, surveyTidy: prior} = storage.settings();
  if (!ai.client && !ai.apiKey) return {changed: 0, reason: 'no-ai'};
  if (surveyMovedAt && (!prior?.before || prior.undone)) return {changed: 0};
  const it = store.openStore(storage, {fetcher}), lines = await linesOf(it);
  // Moved before, but a line is back as the bullet it was (a rolled-back run, owner's app.log 17 Oct 2026): move those again. Not after Undo.
  const kept = (prior?.before || []).filter(each => lines.some(line => line.text === each.value));
  if (surveyMovedAt && !(prior.before || []).some(each => lines.some(line => line.text === each.was))) return {changed: 0};
  const read = lines.map(line => ({line, read: readLine(line.text)}));
  const todo = read.filter(each => each.read.type === 'other').map(each => ({id: String(lines.indexOf(each.line)), text: each.read.text, line: each.line}));
  const taken = new Set(read.filter(each => each.read.type === 'answer').map(each => each.read.key));
  const planned = await plan(todo, taken, ai);
  const moved = todo.filter(each => planned.has(each.id));
  const changes = moved.flatMap(each => [{op: 'text', id: each.line.id, value: planned.get(each.id)[0], was: each.line.text},
    ...(planned.get(each.id).length > 1 ? [{op: 'insert', after: each.line.id, lines: planned.get(each.id).slice(1)}] : [])]);
  const texts = changes.flatMap(change => change.op === 'insert' ? change.lines : [change.value]);   // every line this run writes
  if (!changes.length) {
    // Nothing trusted is not "done": one unreadable or refused AI answer must not end the move for good (owner's survey lines stayed prose). Asked again on the next open, up to TRIES times.
    const tries = (storage.settings().surveyTries || 0) + 1;
    if (!todo.length || tries >= TRIES) storage.saveSettings({surveyMovedAt: now.toISOString(), surveyTries: 0}); else storage.saveSettings({surveyTries: tries});
    return {changed: 0, ...(todo.length ? {reason: 'no-answer-trusted'} : {})};
  }
  const backup = await copy(storage, {fetcher, now});
  try {
    const {missing} = await applyEdits(it.page('profile'), await it.page('profile').outline(), changes);
    const written = (await linesOf(it)).map(line => line.text);
    if (missing.length || !texts.every(text => written.includes(text))) throw new Error(`The survey answers: some lines did not save; nothing was removed (the pages before it are in ${backup.dir})`);
  } catch (error) {
    // Put back only the lines still holding what this run wrote (another run's lines are not ours to roll back).
    const current = await linesOf(it).catch(() => []);
    const back = changes.flatMap(change => change.op === 'insert' ? change.lines.map(text => ({op: 'remove', id: current.find(line => line.text === text)?.id, was: text}))
      : [{op: 'text', id: current.find(line => line.text === change.value)?.id, value: change.was}]).filter(change => change.id !== undefined);
    await applyEdits(it.page('profile'), await it.page('profile').outline(), back).catch(() => {});
    throw error;
  }
  storage.saveSettings({surveyMovedAt: now.toISOString(), surveyTidy: {at: now.toISOString(), dir: backup.dir, changed: moved.length, before: [...kept, ...changes.flatMap(change => change.op === 'insert' ? change.lines.map(text => ({value: text, was: null})) : [{value: change.value, was: change.was}])]}});
  return {changed: moved.length, copy: backup};
}

// Undo: the bullets as they were. Not moved again.
export async function undo(storage, {fetcher} = {}) {
  const done = storage.settings().surveyTidy;
  if (!done?.before || done.undone) return {ok: false, error: 'There is nothing to undo'};
  const it = store.openStore(storage, {fetcher}), lines = await linesOf(it);
  // A line the move added (was: null) is removed; every other goes back to its bullet.
  const changes = done.before.map(each => ({op: each.was === null ? 'remove' : 'text', id: lines.find(line => line.text === each.value)?.id, value: each.was, was: each.value})).filter(change => change.id !== undefined);
  await applyEdits(it.page('profile'), await it.page('profile').outline(), changes);
  storage.saveSettings({surveyTidy: {...done, before: undefined, undone: true}});
  return {ok: true};
}

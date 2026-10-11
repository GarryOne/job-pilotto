// The settings files' notes kept out of every setting and prompt: the repo's defaults (config/*.json, copied by pipeline-env.js ensureConfig) carry notes for
// their readers ("_comment": "Example search settings ... not anyone's real search"), and a copy reached the fill prompt's <search_preferences> (11 Oct 2026).
// A key starting with "_" is such a note, never a setting: dropped when a file is created or saved, when a prompt reads it, and from existing files at start.
// Guard: desktop/test/config-notes.test.js.
import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILES = ['search.json', 'preferences.json', 'sources.json', 'scout_seeds.json'];   // what ensureConfig copies
export const isNote = key => String(key).startsWith('_');

// The value with every note key removed, at any depth (the inputs are not changed).
export function withoutNotes(value) {
  if (Array.isArray(value)) return value.map(withoutNotes);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isNote(key)).map(([key, item]) => [key, withoutNotes(item)]));
}

export const hasNotes = value => JSON.stringify(withoutNotes(value)) !== JSON.stringify(value);
const asText = value => `${JSON.stringify(value, null, 2)}\n`;

// A settings file as a prompt may see it: its JSON without notes ('' when missing; a file that is not JSON is left out rather than sent as it is).
export function configForPrompt(storage, name) {
  const text = storage.readText(path.posix.join('config', name)) || '';
  if (!text.trim()) return '';
  try { return asText(withoutNotes(JSON.parse(text))); } catch { return ''; }
}

// A repo default copied without its notes. -> true when written.
export function copyWithoutNotes(source, target) {
  const value = JSON.parse(fs.readFileSync(source, 'utf8'));
  fs.writeFileSync(target, asText(withoutNotes(value)));
  return true;
}

// Existing files cleaned in place (a copy made before 11 Oct 2026 kept the note): only a file that has notes is rewritten. -> the names cleaned.
export function cleanConfigFiles(storage, names = CONFIG_FILES) {
  const cleaned = [];
  for (const name of names) {
    const file = storage.path(path.join('config', name));
    let value;
    try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }   // missing or not JSON: not ours to rewrite
    if (!hasNotes(value)) continue;
    fs.writeFileSync(file, asText(withoutNotes(value)));
    cleaned.push(name);
  }
  return cleaned;
}

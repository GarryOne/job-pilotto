// No note of the repo's example settings reaches a user's settings or any prompt (lib/config-text.js): every file ensureConfig copies is created without its
// "_" notes, an existing copy is cleaned at start, a save drops them, and every prompt that reads a settings file reads it without them. 11 Oct 2026: the
// example search's "_comment" ("not anyone's real search") rode in the fill prompt's <search_preferences> on one path only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {CONFIG_FILES, configForPrompt, hasNotes} from '../lib/config-text.js';
import {REPO, ensureConfig} from '../lib/pipeline-env.js';
import {save} from '../lib/strategy-settings.js';
import {localEnv} from '../lib/server-env.js';

const fakeCrypto = {encrypt: value => value, decrypt: value => value};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-notes-')), fakeCrypto);
const readJson = (storage, name) => JSON.parse(fs.readFileSync(storage.path(path.join('config', name)), 'utf8'));
const LIB = path.resolve(import.meta.dirname, '..', 'lib');

test('the class: ensureConfig copies exactly the files this guard loops over, and the repo\'s defaults do carry notes', () => {
  const source = fs.readFileSync(path.join(LIB, 'pipeline-env.js'), 'utf8');
  assert.match(source, /for \(const name of CONFIG_FILES\)/, 'ensureConfig copies the list this test loops over');
  assert.ok(CONFIG_FILES.filter(name => hasNotes(JSON.parse(fs.readFileSync(path.join(REPO, 'config', name), 'utf8')))).length >= 3, 'the positive control: the repo files have notes to drop');
});

test('every file ensureConfig creates has no note, and keeps every setting of the default', () => {
  const storage = tempStorage();
  ensureConfig(storage);
  for (const name of CONFIG_FILES) {
    const made = readJson(storage, name), repo = JSON.parse(fs.readFileSync(path.join(REPO, 'config', name), 'utf8'));
    assert.equal(hasNotes(made), false, `${name} was created with a note`);
    for (const key of Object.keys(Array.isArray(repo) ? {} : repo).filter(key => !key.startsWith('_'))) assert.deepEqual(made[key], repo[key], `${name}: ${key} kept`);
  }
});

test('an existing user\'s copy with a note is cleaned at start by the app itself, the rest kept, and a second start changes nothing', () => {
  const storage = tempStorage();
  for (const name of CONFIG_FILES) storage.writeText(path.join('config', name), JSON.stringify(name === 'sources.json' ? [{_note: 'x', url: 'https://a.example'}] : {_comment: 'Example', mine: [name]}));
  ensureConfig(storage);
  for (const name of CONFIG_FILES) {
    assert.equal(hasNotes(readJson(storage, name)), false, `${name} kept its note`);
    assert.deepEqual(readJson(storage, name), name === 'sources.json' ? [{url: 'https://a.example'}] : {mine: [name]});
  }
  const before = CONFIG_FILES.map(name => fs.statSync(storage.path(path.join('config', name))).mtimeMs);
  ensureConfig(storage);
  assert.deepEqual(CONFIG_FILES.map(name => fs.statSync(storage.path(path.join('config', name))).mtimeMs), before);
});

test('saving the strategy drops notes from what it merges', () => {
  const storage = tempStorage();
  storage.writeText('config/search.json', JSON.stringify({_comment: 'Example', role_keywords: ['old']}));
  storage.writeText('config/preferences.json', JSON.stringify({_comment: 'Example', digest_min_score: 60}));
  save(storage, {search: {role_keywords: ['sre'], _comment: 'from a draft'}, preferences: {work_rights: ['eu']}});
  assert.equal(hasNotes(readJson(storage, 'search.json')), false);
  assert.equal(hasNotes(readJson(storage, 'preferences.json')), false);
  assert.deepEqual(readJson(storage, 'search.json').role_keywords, ['sre']);
});

test('every prompt that reads a settings file reads it without notes', async () => {
  const storage = tempStorage();
  storage.writeText('config/search.json', JSON.stringify({_comment: 'Example search settings, not anyone\'s real search', role_keywords: ['sre']}));
  assert.doesNotMatch(configForPrompt(storage, 'search.json'), /_comment|not anyone/);
  // The fill prompt's <search_preferences> (worker answerForm reads env.SEARCH_TEXT).
  const text = await localEnv(storage).SEARCH_TEXT;
  assert.match(text, /sre/);
  assert.doesNotMatch(text, /_comment|not anyone/);
  // Every other reader: a settings file is read raw only through configForPrompt; JSON.parse picks named fields (no note can ride along); a raw `…before`
  // copy is a rollback, written back as it was when a change fails (lib/strategy-settings.js), never sent anywhere.
  for (const name of fs.readdirSync(LIB).filter(file => file.endsWith('.js'))) {
    for (const [index, line] of fs.readFileSync(path.join(LIB, name), 'utf8').split('\n').entries()) {
      for (const read of line.matchAll(/(\w+) = storage\.readText\(['"]config\/|readText\(['"]config\//g)) {
        const rollback = /before$/i.test(read[1] || ''), parsed = /JSON\.parse\(/.test(line.slice(Math.max(0, read.index - 20), read.index));
        assert.ok(rollback || parsed,
          `${name}:${index + 1} reads a settings file as raw text: use configForPrompt (lib/config-text.js)`);
      }
    }
  }
});

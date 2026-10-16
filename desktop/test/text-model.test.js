// The cards' model (renderer/text-model.js): text → rows → text is identical for each of the three texts, an unreadable line stays a row, an edit rewrites only its line.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {line, parse} from '../lib/knowledge.js';
import {KINDS, newItem, parseText, sectionEnd, sections, serializeText, withNote, withValue} from '../renderer/text-model.js';

const demo = file => fs.readFileSync(new URL(`../demo/${file}`, import.meta.url), 'utf8');
const TEXTS = {profile: 'profile.md', answers: 'answers.md', knowledge: 'knowledge.md'};
const ODD = '\n\n  * indented star  \n| a | b |\n|---|---|\n| 1 | 2 |\n- **Empty:**\n- **Trailing:** value \nplain paragraph\n[not a note\n';

test('every text comes back identical from its rows, odd lines and trailing spaces included', () => {
  for (const [name, file] of Object.entries(TEXTS)) {
    for (const text of [demo(file), demo(file) + ODD, '', '\n\n']) assert.equal(serializeText(parseText(name, text)), text, name);
  }
});

test('the Form knowledge row reads a line as lib/knowledge.js does, and writes it back the same', () => {
  const notes = demo('knowledge.md').split('\n').filter(Boolean).map(text => text.replace(/^- /, ''));
  assert.ok(notes.length >= 5);
  for (const text of notes) {
    const row = parseText('knowledge', `- ${text}`)[0], note = parse(text);
    assert.deepEqual([row.type, row.site, row.kind, row.field, row.reason, row.value], ['note', note.scope, note.kind, note.field, note.note, note.value], text);
    assert.ok(KINDS.includes(row.kind), row.kind);
    assert.equal(withNote(row, {reason: 'x'}).raw, `- ${line({...note, note: 'x'})}`);
  }
});

test('a line that is not a note stays a raw row, shown and kept', () => {
  const rows = parseText('knowledge', '- [any · answer] Q: why → "A"\nsomething free-hand\n- [broken');
  assert.deepEqual(rows.map(row => row.type), ['note', 'raw', 'raw']);
  assert.deepEqual(sections('knowledge', rows).flatMap(group => group.items.map(item => item.row.raw)).slice(1), ['something free-hand', '- [broken']);
});

test('an edit rewrites only its line; an unchanged field keeps the original bytes', () => {
  const text = demo('answers.md'), rows = parseText('answers', text);
  const at = rows.findIndex(row => row.type === 'item');
  assert.equal(withValue(rows[at], rows[at].value).raw, rows[at].raw);
  const edited = rows.map((row, i) => i === at ? withValue(row, 'New text\nover two lines') : row);
  const lines = serializeText(edited).split('\n');
  assert.equal(lines[at], `${rows[at].head} New text over two lines`);
  assert.deepEqual(lines.filter((_, i) => i !== at), text.split('\n').filter((_, i) => i !== at));
  const note = parseText('knowledge', '- [any · answer] Q: why → "A"')[0];
  assert.equal(withNote(note, {value: ''}).raw, '- [any · answer] Q: why');
  assert.equal(withNote(note, {kind: 'option', value: 'B'}).raw, '- [any · option] Q: why → "B"');
});

test('sections: headings group answers and Profile; Form knowledge groups by site with "any" first; a new item lands at the end of its section', () => {
  const profile = sections('profile', parseText('profile', demo('profile.md')));
  assert.deepEqual(profile.map(group => group.key).slice(1), ['Targets', 'Strengths', 'Deal-breakers']);
  const sites = sections('knowledge', parseText('knowledge', demo('knowledge.md'))).map(group => group.key);
  assert.equal(sites[0], 'any');
  assert.equal(new Set(sites).size, sites.length);
  const rows = parseText('answers', '## A\n- **x:** 1\n\n## B\n- **y:** 2\n');
  rows.splice(sectionEnd(rows, 0), 0, newItem('Phone', '+41 00'));
  assert.equal(serializeText(rows), '## A\n- **x:** 1\n- **Phone:** +41 00\n\n## B\n- **y:** 2\n');
});

// Form knowledge rules (renderer/knowledge-model.js): read as lib/knowledge.js reads a note, written back the same, other lines kept.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {line, parse} from '../lib/knowledge.js';
import {outline} from '../lib/store/markdown-page.js';
import {BY_HAND, label, lineOf, matches, noteOf, rules, sites} from '../renderer/knowledge-model.js';

const demo = fs.readFileSync(new URL('../demo/knowledge.md', import.meta.url), 'utf8');

test('a rule reads as lib/knowledge.js reads the note, and its line is the one lib/knowledge.js writes', () => {
  for (const item of outline(demo)) {
    const rule = noteOf(item.text), note = parse(item.text);
    assert.deepEqual([rule.site, rule.kind, rule.field, rule.reason, rule.value], [note.scope, note.kind, note.field, note.note, note.value]);
    assert.equal(lineOf(rule), line(note));
    assert.equal(lineOf(rule), item.text);
  }
});

test('lines that are not notes stay as other lines; sites list "any" first; filters', () => {
  const list = rules(outline(`Intro: what this page is for\n${demo}- [broken`));
  assert.deepEqual(list.filter(rule => rule.other).map(rule => rule.text), ['Intro: what this page is for', '[broken']);
  assert.equal(sites(list)[0], 'any');
  assert.equal(list.filter(rule => matches(rule, {site: 'careers.fictional-bank.test'})).length, 3);
  assert.equal(list.filter(rule => matches(rule, {kind: 'widget'})).length, 1);
  assert.equal(list.filter(rule => matches(rule, {query: 'SALARY'})).length, 1);
});

test('a rule added by hand says so, and a field\'s trailing colons are not part of its label', () => {
  assert.equal(lineOf({site: '', kind: 'answer', field: 'Salutation', reason: '', value: 'Mr'}), `[any · answer] Salutation: ${BY_HAND} → "Mr"`);
  assert.equal(label('Name ::'), 'Name');
  assert.equal(noteOf('[jobs.example.test · answer] Name :: Field ID x asks for last name. → "Doe"').field, 'Name :');
});

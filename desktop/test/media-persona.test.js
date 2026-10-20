// The product media's personas (desktop/scripts/media/persona-copy.mjs, personas/): a persona lays its files over desktop/demo, its dates move to the
// recording's week, and no persona folder holds the default person's words it forbids.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {leftWords} from '../scripts/media/check.mjs';
import {loadPersona} from '../scripts/media/options.mjs';
import {personaCopy, shiftDates, weekShift} from '../scripts/media/persona-copy.mjs';
import {formHost} from '../scripts/media/stand-in.mjs';

const media = path.join(import.meta.dirname, '..', 'scripts', 'media');
const demo = path.join(import.meta.dirname, '..', 'demo');

test('dates move by whole weeks, so weekday names stay right; no anchor, no move', () => {
  assert.equal(weekShift('2026-10-12', new Date(2026, 9, 12)), 0);
  assert.equal(weekShift('2026-10-12', new Date(2026, 10, 3)), 21, '22 days away: the nearest whole week');
  assert.equal(weekShift('', new Date(2027, 0, 1)), 0);
  const text = 'Interview Wed 14 Oct, 10:00 · 2026-10-14T10:00:00+02:00 · since 2026-09-29 · on 28 Dec';
  assert.equal(shiftDates(text, 21, 2026), 'Interview Wed 04 Nov, 10:00 · 2026-11-04T10:00:00+02:00 · since 2026-10-20 · on 18 Jan');
  assert.equal(shiftDates(text, 0, 2026), text);
});

test('a persona lays its own files over the demo; media.json stays out; dates are shifted', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-persona-'));
  fs.writeFileSync(path.join(folder, 'jobs.json'), JSON.stringify({jobs: [{title: 'Nurse', next_interview: '2026-10-14T10:00:00'}]}));
  fs.writeFileSync(path.join(folder, 'media.json'), '{}');
  fs.mkdirSync(path.join(folder, 'config'));
  fs.writeFileSync(path.join(folder, 'config', 'search.json'), '{"role_keywords": ["nurse"]}');
  const data = personaCopy({folder, today: '2026-10-12'}, {demo, now: new Date(2026, 9, 26)});
  try {
    assert.match(fs.readFileSync(path.join(data, 'jobs.json'), 'utf8'), /Nurse.*2026-10-28T10:00/);
    assert.ok(fs.existsSync(path.join(data, 'focus.json')), 'a file the persona does not change comes from the demo');
    assert.ok(!fs.existsSync(path.join(data, 'media.json')));
    assert.match(fs.readFileSync(path.join(data, 'config', 'search.json'), 'utf8'), /nurse/, 'the engine\'s settings folder comes along');
  } finally { fs.rmSync(folder, {recursive: true, force: true}); fs.rmSync(data, {recursive: true, force: true}); }
});

test('every persona folder loads, is anchored on a Monday, and holds none of the words it forbids', () => {
  const root = path.join(media, 'personas');
  const names = fs.readdirSync(root);
  assert.ok(names.includes('nurse-lyon'));
  for (const name of names) {
    const persona = loadPersona(path.join(root, name));
    assert.ok(persona.forbid.length, `${name}: media.json lists the default person's words (forbid)`);
    assert.equal(new Date(`${persona.today}T12:00:00Z`).getUTCDay(), 1, `${name}: "today" is a Monday`);
    const files = fs.readdirSync(path.join(root, name), {recursive: true}).filter(file => file !== 'media.json' && fs.statSync(path.join(root, name, file)).isFile());
    for (const file of files) {
      assert.deepEqual(leftWords(fs.readFileSync(path.join(root, name, file), 'utf8'), persona.forbid), [], `${name}/${file}`);
    }
  }
});

test('the default person\'s words are found as whole words only; the form lives on the employer\'s .example host', () => {
  assert.deepEqual(leftWords('Senior SRE in Zurich', ['SRE', 'Zurich', 'Kubernetes']), ['SRE', 'Zurich']);
  assert.deepEqual(leftWords('SREs are a different word', ['SRE']), []);
  assert.equal(formHost({company: 'Institut Cardio Rhône'}), 'careers.institut-cardio-rhone.example');
  assert.equal(formHost({}), 'careers.employer.example');
});

// The search report (lib/search-report.js): only listed fields, counts and seconds, nothing a person wrote; sent only with Technical reports on.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {FIELDS, FAMILIES, record, reportSearch} from '../lib/search-report.js';
import {create, KINDS} from '../lib/telemetry.js';

const storageWith = (settings = {}) => {
  const files = {};
  return {settings: () => settings, saveSettings: next => Object.assign(settings, next), secret: () => '', readText: n => files[n], writeText: (n, t) => { files[n] = t; }};
};
const measured = {family: 'hospitality', country: 'CH', city: 'zurich', in_places: 40, scored: 12, fit70: 3, first_s: 9, tenth_s: 41, first_fit70_s: 77};

test('a search is a telemetry kind', () => assert.ok(KINDS.includes('search')));

test('the record keeps listed fields and drops anything else, including text and wrong shapes', () => {
  const got = record({...measured, title: 'Barista at Acme', link: 'https://x.y/job/1', cv: 'my CV', email: 'a@b.c', in_places: -3, family: 'barista', city: 'https://x.y'}, {nth: 2});
  assert.deepEqual(Object.keys(got).sort(), ['country', 'first_fit70_s', 'first_s', 'fit70', 'nth', 'scored', 'tenth_s']);
  for (const value of Object.values(got)) assert.ok(typeof value === 'number' || /^[A-Z]{2}$/.test(value));
});

test('every listed field is the one the privacy page names, and the family list equals the engine\'s', () => {
  assert.deepEqual(Object.keys(FIELDS).sort(), ['city', 'country', 'engine', 'family', 'first_fit70_s', 'first_s', 'fit70', 'in_places', 'nth', 'runs_to_fit70', 'scored', 'tenth_s', 'trigger']);
  const py = fs.readFileSync(new URL('../../src/role_kinds.py', import.meta.url), 'utf8').match(/^KINDS = \(([^)]*)\)/m)[1].match(/'(\w+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(FAMILIES, py);
});

test('one report per finished run: the nth search and the runs until the first 70+; off or failed: nothing', async () => {
  const storage = storageWith(), telemetry = create(storage, {version: '1', fetcher: async () => ({ok: true})});
  const answers = [{...measured, fit70: 0}, measured, measured];
  const exec = async () => ({code: 0, stdout: `noise\n${JSON.stringify(answers.shift())}\n`});
  const a = await reportSearch(storage, telemetry, {startedAt: 't', ok: true, trigger: 'first'}, exec);
  const b = await reportSearch(storage, telemetry, {startedAt: 't', ok: true, trigger: 'you'}, exec);
  const c = await reportSearch(storage, telemetry, {startedAt: 't', ok: true, trigger: 'schedule'}, exec);
  assert.deepEqual([a.kind, a.nth, a.runs_to_fit70], ['search', 1, undefined]);
  assert.deepEqual([b.nth, b.runs_to_fit70, c.nth, c.runs_to_fit70], [2, 2, 3, 2]);
  assert.equal(await reportSearch(storage, telemetry, {startedAt: 't', ok: false}, exec), null);
  storage.saveSettings({telemetry: false});
  assert.equal(await reportSearch(storage, telemetry, {startedAt: 't', ok: true}, async () => assert.fail('no measuring when reports are off')), null);
});

test('Settings and the privacy page both say that search counts and times are sent', () => {
  const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(read('../renderer/index.html'), /After each search: how many jobs it found and scored, and how many seconds it took/);
  assert.match(read('../../site/public/privacy.html'), /after each search how many jobs it found in your places/);
});

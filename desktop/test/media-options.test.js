// The media command's pure parts (desktop/scripts/media/options.mjs, stand-in.mjs): pieces, persona folders, the director's plan, the stand-in's answers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {jpegWidth, loadPersona, parseArgs, planOf, withPlan} from '../scripts/media/options.mjs';
import {VIDEOS} from '../scripts/media/scenes.mjs';
import {answerReply, formHtml} from '../scripts/media/stand-in.mjs';

const demo = path.join(import.meta.dirname, '..', 'demo');

test('pieces: all by default, some by name, an unknown one refused', () => {
  assert.deepEqual(parseArgs([]).pieces, [...Object.keys(VIDEOS), 'stills', 'snips']);
  assert.deepEqual(parseArgs(['hero', '--out', 'x']).pieces, ['hero']);
  assert.throws(() => parseArgs(['heroes']), /unknown piece heroes/);
});

test('the demo folder is a persona; a folder with a real key or no profile is refused; media.json overrides the defaults', () => {
  assert.equal(loadPersona(demo).applicant.first_name, 'Alex');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-persona-'));
  assert.throws(() => loadPersona(folder), /not a persona folder/);
  fs.writeFileSync(path.join(folder, 'profile.md'), '# Nurse');
  fs.writeFileSync(path.join(folder, 'media.json'), JSON.stringify({name: 'nurse-lyon', applicant: {first_name: 'Camille'}, job: {company: 'Clinique du Parc'}}));
  const persona = loadPersona(folder);
  assert.equal(persona.name, 'nurse-lyon');
  assert.equal(persona.applicant.first_name, 'Camille');
  assert.equal(persona.applicant.email, 'alex.morgan@example.com', 'unset fields keep the defaults');
  assert.equal(persona.job.company, 'Clinique du Parc');
  fs.writeFileSync(path.join(folder, 'secrets.json'), JSON.stringify({NOTION_TOKEN: 'ntn_5f8a2c9d1e3b4a6f7c8d9e0a1b2c3d4e'}));
  assert.throws(() => loadPersona(folder), /real-looking keys/);
  fs.rmSync(folder, {recursive: true, force: true});
});

test('the director\'s plan sets a zoom per look and the manifest\'s words; no plan keeps the scene', () => {
  assert.equal(withPlan(VIDEOS.hero, null), VIDEOS.hero);
  const planned = withPlan(VIDEOS.hero, {zooms: {'#jobs-body': 1.3}, caption: 'Jobs that fit you'});
  assert.equal(planned.steps.find(step => step.look === '#jobs-body').zoom, 1.3);
  assert.equal(planned.caption, 'Jobs that fit you');
  assert.equal(planOf('no-such-piece', os.tmpdir()), null);
});

test('the stand-in answers only the questions asked, with the persona\'s words; the form shows the persona\'s job', () => {
  const reply = answerReply(JSON.stringify({fields: [{field: 'permit'}, {field: 'unknown'}]}), {permit: 'Yes', notice: '1 month'});
  assert.deepEqual(reply, {ok: true, eligible: true, answers: [{field: 'permit', value: 'Yes'}]});
  assert.deepEqual(answerReply('not json', {permit: 'Yes'}).answers, []);
  const page = formHtml(fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'media', 'form.html'), 'utf8'), {company: 'Clinique du Parc', title: 'Nurse', place: 'Lyon, France', city: 'Lyon'});
  assert.ok(page.includes('<h1>Nurse</h1>') && page.includes('Clinique du Parc') && !page.includes('{{'));
});

test('a frame\'s width is read from its JPEG header', () => {
  const sof = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x08, 0xca, 0x0e, 0x10]);
  assert.equal(jpegWidth(sof), 3600);
});

// The experience bank: other CV versions only add facts to the main CV's roles (lib/experience.js), and tailoring uses them without
// counting an unused extra as a drop. A fake AI answers the transcription and the match.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cv from '../lib/cv.js';
import * as experience from '../lib/experience.js';
import {createStorage} from '../lib/storage.js';

const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-exp-')), {encrypt: v => v, decrypt: v => v});
const MAIN = {name: 'Ada Example', summary: 'SRE with AWS.', skills: 'AWS, Terraform', jobs: [
  {company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Cut costs by **50%**.', 'Ran incidents.'], skills: 'AWS'}]},
  {company: 'Beta', roles: [{title: 'Developer', period: '2020 – 2023', place: 'Remote', bullets: ['Built APIs.']}]}]};
const OTHER = {name: 'Ada Example', skills: 'AWS, Python, Spark', jobs: [
  {company: 'Acme Inc.', roles: [{title: 'Site Reliability Engineer', period: '2024 – now', place: 'Zurich', bullets: ['Cut costs by 50%.', 'Built Spark pipelines for 2 TB of logs.']}]},
  {company: 'Gamma', roles: [{title: 'Data Engineer', period: '2018 – 2019', place: 'Bern', bullets: ['Trained models.']}]}]};
const ANSWER = {roles: [{source_role: 0, main_job: 0, main_role: 0, new_bullets: [1]}, {source_role: 1, main_job: -1, main_role: -1, new_bullets: []}]};

const fakeClient = (calls = []) => ({messages: {create: async request => {
  calls.push(request.system.slice(0, 20));
  const body = /compare/.test(request.system) ? ANSWER : OTHER;
  return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(body)}], usage: {input_tokens: 10, output_tokens: 10}};
}}});

const withMain = () => { const s = tempStorage(); fs.mkdirSync(cv.dir(s), {recursive: true}); fs.writeFileSync(path.join(cv.dir(s), 'cv.json'), JSON.stringify(MAIN)); return s; };
const pdf = s => { const file = path.join(os.tmpdir(), `exp-${Math.random().toString(36).slice(2)}.pdf`); fs.writeFileSync(file, `%PDF ${Math.random()}`); return file; };

test('checkMatch keeps real roles, one source per main role, real bullet indexes', () => {
  const answer = {roles: [
    {source_role: 0, main_job: 0, main_role: 0, new_bullets: [1, 1, 9, -1]},
    {source_role: 1, main_job: 0, main_role: 0, new_bullets: [0]},        // the main role is taken: no match
    {source_role: 7, main_job: 0, main_role: 0, new_bullets: []}]};       // no such source role
  const match = experience.checkMatch(answer, MAIN, OTHER);
  assert.deepEqual(match, [{sourceRole: 0, mainJob: 0, mainRole: 0, newBullets: [1]}, {sourceRole: 1, mainJob: -1, mainRole: -1, newBullets: []}]);
  assert.equal(experience.checkMatch({roles: []}, MAIN, OTHER).length, 2, 'a role the AI forgot is unmatched, not lost');
});

test('adding a version: transcribed, matched, kept; refused twice and without a main CV', async () => {
  const s = withMain(), file = pdf(), calls = [];
  const source = await experience.addCv(s, file, 'Data CV', {client: fakeClient(calls)});
  assert.equal(calls.length, 2);
  assert.deepEqual(source.match[0], {sourceRole: 0, mainJob: 0, mainRole: 0, newBullets: [1]});
  assert.equal(experience.list(s).length, 1);
  await assert.rejects(experience.addCv(s, file, 'again', {client: fakeClient()}), /already there/);
  await assert.rejects(experience.addCv(tempStorage(), file, 'x', {client: fakeClient()}), /main CV first/);
  const view = experience.view(s);
  assert.equal(view.sources[0].added, 1);
  assert.deepEqual(view.sources[0].onlyHere.map(r => r.company), ['Gamma']);
  assert.ok(experience.remove(s, source.id));
  assert.equal(experience.list(s).length, 0);
});

test('withExtras adds only matched, new bullets; the jobs, titles and dates stay the main CV\'s', async () => {
  const s = withMain();
  await experience.addCv(s, pdf(), 'Data CV', {client: fakeClient()});
  const merged = experience.withExtras(s, MAIN);
  const role = merged.jobs[0].roles[0];
  assert.deepEqual(role.bullets, [...MAIN.jobs[0].roles[0].bullets, 'Built Spark pipelines for 2 TB of logs.']);
  assert.deepEqual(role.extra, [2]);
  assert.equal(role.extraFrom[2], 'Data CV');
  assert.deepEqual(merged.jobs.map(j => [j.company, j.roles.map(r => [r.title, r.period, r.place])]), MAIN.jobs.map(j => [j.company, j.roles.map(r => [r.title, r.period, r.place])]));
  assert.equal(merged.jobs.length, 2, 'a role only another version has is not added to the CV');
  assert.equal(merged.extraSkills, 'Python, Spark');
  assert.equal(MAIN.jobs[0].roles[0].bullets.length, 2, 'the main CV is not changed');
  // A main CV that changed since the match: its extras are left out until matched again.
  const changed = structuredClone(MAIN); changed.jobs[0].roles[0].bullets.push('New one.');
  assert.equal(experience.withExtras(s, changed).jobs[0].roles[0].extra, undefined);
});

test('tailoring with extras: an unused extra is no drop, a used one is marked added, the helper fields do not leak', async () => {
  const s = withMain();
  await experience.addCv(s, pdf(), 'Data CV', {client: fakeClient()});
  const base = experience.withExtras(s, MAIN);
  const pick = (bullets) => ({summary: 'SRE with AWS.', changes: [], jobs: [
    {company: 'Acme', roles: [{title: 'SRE', skills: 'AWS', bullets}]},
    {company: 'Beta', roles: [{title: 'Developer', skills: '', bullets: [{source: 0, text: 'Built APIs.'}]}]}]});
  const unused = cv.applyTailoring(base, pick([{source: 0, text: 'Cut costs by **50%**.'}, {source: 1, text: 'Ran incidents.'}]), '');
  assert.deepEqual(unused.warnings, []);
  assert.deepEqual(unused.review.jobs[0].roles[0].dropped, []);
  const used = cv.applyTailoring(base, pick([{source: 2, text: 'Built Spark pipelines for 2 TB of logs.'}, {source: 0, text: 'Cut costs by **50%**.'}]), experience.knownText(s, MAIN));
  assert.deepEqual(used.review.jobs[0].roles[0].bullets.map(b => b.mark), ['added', 'kept']);
  assert.equal(used.review.jobs[0].roles[0].bullets[0].addedFrom, 'Data CV');
  assert.deepEqual(used.review.jobs[0].roles[0].dropped, ['Ran incidents.']);
  for (const out of [used.cv, used.review]) { assert.equal(out.jobs[0].roles[0].extra, undefined); assert.equal(out.extraSkills, undefined); }
});

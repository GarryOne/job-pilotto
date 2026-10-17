// Ready to send, tonight's batch (lib/ready-batch.js): only finished jobs go, best first, the batch carries what the night needs and nothing half-made, and a morning is named right.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBatch, nightOf, pickToSend} from '../lib/ready-batch.js';

const job = (code, fit, extra = {}) => ({code, url: `https://boards.example.com/${code}`, title: `Role ${code}`, company: 'Acme', fit, status: 'unreviewed', kit: true, tailored: true, letter: true, ...extra});

test('only finished, open jobs at or above the fit go, saved first, then by fit, up to the night\'s number', () => {
  const jobs = [job('a', 90), job('b', 70, {status: 'saved'}), job('c', 50), job('d', 80, {letter: false}), job('e', 85, {status: 'applied'}), job('f', 75, {ineligible: 'needs German'}), job('g', 65)];
  assert.deepEqual(pickToSend(jobs, {minFit: 60, perNight: 10}).map(j => j.code), ['b', 'a', 'g']);
  assert.deepEqual(pickToSend(jobs, {minFit: 60, perNight: 2}).map(j => j.code), ['b', 'a']);
});

test('a night is for the next morning after noon and for today after midnight; the fill is at 02:00', () => {
  assert.equal(nightOf(new Date(2026, 9, 17, 19, 30)).night, '2026-10-18');
  assert.equal(nightOf(new Date(2026, 9, 18, 1, 10)).night, '2026-10-18');
  assert.equal(new Date(nightOf(new Date(2026, 9, 17, 19, 30)).fillAt).getHours(), 2);
});

test('the batch carries the kit, CV, letter and facts; a job without a kit or a CV file is left out and said so', async () => {
  const kits = {a: {answers: [{field: 'notice', answer: '2 months'}], cover_letter: 'Dear Acme'}, c: {answers: []}};
  const mine = {a: {contact: {name: 'Alex Example'}, resume: {data: 'CVDATA'}, coverLetterFile: {data: 'LETTERPDF'}}, b: {contact: {}, resume: null}, c: {contact: {name: 'x'}, resume: {data: 'C2'}}};
  let asked = 0;
  const deps = {store: {findJob: async url => ({id: url.split('/').pop()}), kit: async id => kits[id] || null}, me: async url => mine[url.split('/').pop()], facts: async () => { asked++; return {profile: 'P'}; }};
  const {batch, skipped} = await buildBatch([job('a', 90), job('b', 80), job('c', 70), job('z', 60)], deps, {now: new Date(2026, 9, 17, 20, 0)});
  assert.deepEqual(batch.jobs.map(j => j.id), ['a', 'c']);
  assert.deepEqual(batch.jobs[0], {id: 'a', url: 'https://boards.example.com/a', title: 'Role a', company: 'Acme', fit: 90, kit: {answers: [{field: 'notice', answer: '2 months'}]}, letter: 'Dear Acme', cv: 'CVDATA', letterPdf: 'LETTERPDF'});
  assert.deepEqual(skipped.map(s => [s.code, s.why]), [['b', 'no kit found'], ['z', 'no kit found']]);
  assert.equal(batch.contact.name, 'Alex Example');
  assert.deepEqual(batch.facts, {profile: 'P'});
  assert.equal(batch.night, '2026-10-18');
  const none = await buildBatch([job('b', 80)], deps);
  assert.deepEqual(none.batch.facts, {});   // nothing to send: your facts are not even read
  assert.equal(asked, 1);
});

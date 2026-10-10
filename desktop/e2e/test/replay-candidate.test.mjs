// The replay candidates the nightly smoke saves for a failing shape (lib/replay-candidate.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {dropCandidate, saveCandidate, slug, worthSaving} from '../lib/replay-candidate.mjs';

test('a failure is worth keeping; a pass, a documented hold and a posting that is gone are not', () => {
  assert.equal(worthSaving({reached: 'form', filled: 4, left: 8, short: {done: 4, total: 12}}), true);   // 4 of 13 showed blue
  assert.equal(worthSaving({reached: 'posting'}), true);
  assert.equal(worthSaving({reached: 'account'}), true);
  assert.equal(worthSaving({reached: 'form', filled: 6, left: 6, short: null}), false);
  assert.equal(worthSaving({reached: 'ready', filled: 5, left: 0}), false);
  assert.equal(worthSaving({reached: 'code/bot'}), false);   // never past a bot check: not a bug
  assert.equal(worthSaving({reached: 'none', note: 'posting gone (HTTP 404)'}), false);
  assert.equal(worthSaving(null), false);
});

test('a candidate is a folder with the page and a case.json that says what the run saw, with no query string in the address', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-candidates-'));
  const result = {url: 'https://jobs.example.com/o/role?token=abc#x', reached: 'form', filled: 4, left: 8, short: {done: 4, total: 12}, path: [{kind: 'form', host: 'jobs.example.com'}], fieldList: [{outcome: 'left', type: 'text', label: 'City', required: true, reason: 'no answer known'}]};
  const folder = saveCandidate({dir, day: '2026-10-10', shape: 'Recruitee form', result, html: '<!doctype html><p>form</p>', output: 'x\n  log [extension] fill: page kind: form {"by":"ai"}\nz'});
  assert.equal(folder, path.join(dir, '2026-10-10', 'recruitee-form'));
  const item = JSON.parse(fs.readFileSync(path.join(folder, 'case.json'), 'utf8'));
  assert.equal(item.pages[0].url, 'https://jobs.example.com/o/role');   // never the query or fragment
  assert.equal(item.sample, 'jobs.example.com');
  assert.equal(item.run.fields[0].label, 'City');
  assert.equal(item.evidence.pageKinds.length, 1);
  assert.deepEqual(item.ai, {});   // the AI's answers are the fixer's to take from the evidence, never invented here
  assert.equal(fs.readFileSync(path.join(folder, 'page.html'), 'utf8'), '<!doctype html><p>form</p>');
  dropCandidate({dir, day: '2026-10-10', shape: 'Recruitee form'});
  assert.equal(fs.existsSync(folder), false);
});

test('no page or no failure saves nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-candidates-'));
  assert.equal(saveCandidate({dir, day: 'd', shape: 's', result: {reached: 'form', short: {done: 1, total: 4}}, html: ''}), null);
  assert.equal(saveCandidate({dir, day: 'd', shape: 's', result: {reached: 'ready'}, html: '<p/>'}), null);
  assert.equal(slug('H&M careers (career.hm.com)'), 'h-m-careers-career-hm-com');
});

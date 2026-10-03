// lib/match-check.js: the CV as text, the answer's shape and limits, and the kept answer per job.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {check, cvText, save, saved} from '../lib/match-check.js';

const cv = {summary: 'Platform engineer **eight** years.', skills: 'Kubernetes, Terraform', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2020 – Present', place: 'Zurich', bullets: ['Ran the on-call rota', 'Moved 40 services to Kubernetes'], skills: 'AWS'}]}]};
const job = {title: 'Platform Engineer', company: 'Beta', location: 'London', description: 'You will run Kubernetes and Prometheus. Must have the right to work in the UK. Three days a week in the office.'};

test('the CV is given to the model as plain text, bullets and skills included', () => {
  const text = cvText(cv);
  assert.match(text, /SRE · Acme · 2020 – Present · Zurich/);
  assert.match(text, /- Moved 40 services to Kubernetes/);
  assert.doesNotMatch(text, /\*\*/);
});

test('the answer is trimmed to its limits and priced; the posting and the CV both go to the model', async () => {
  const fake = {messages: {create: async request => {
    assert.match(request.messages[0].content, /<cv>[\s\S]*Kubernetes[\s\S]*<posting>[\s\S]*Prometheus/);
    return {stop_reason: 'end_turn', usage: {input_tokens: 3000, output_tokens: 700}, content: [{type: 'text', text: JSON.stringify({
      grade: 'B', summary: 'Most of it is stated.', advice: ['a', 'b', 'c', 'd', 'e', 'f'],
      musts: Array.from({length: 13}, (_, i) => ({term: `t${i}`, status: i ? 'missing' : 'found', evidence: ''})),
      knockouts: Array.from({length: 11}, (_, i) => ({requirement: `r${i}`, status: 'check', note: 'confirm it'}))})}]};
  }}};
  const result = await check({}, '', {job, cv, client: fake});
  assert.equal(result.grade, 'B');
  assert.equal(result.musts.length, 10);
  assert.equal(result.knockouts.length, 8);
  assert.equal(result.advice.length, 4);
  assert.equal(result.usd, 0.01);
});

test('the last answer for a job is kept, and said to be old once the CV changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-'));
  const storage = {path: (...parts) => path.join(dir, ...parts)};
  assert.equal(saved(storage, 'ab12cd34', cv), null);
  save(storage, 'ab12cd34', cv, job, {grade: 'C'});
  assert.equal(saved(storage, 'ab12cd34', cv).result.grade, 'C');
  assert.equal(saved(storage, 'ab12cd34', cv).stale, undefined);
  assert.equal(saved(storage, 'ab12cd34', {...cv, summary: 'Changed'}).stale, true);
  assert.equal(saved(storage, '../../etc/passwd', cv), null, 'a code is a file name, nothing more');
});

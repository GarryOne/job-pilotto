// lib/cv-check.js: the parser-readiness checks on a PDF's text and layout, the content review's shape, and the cache of one PDF's result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {analyse, hashOf, linesOf, review, save, saved} from '../lib/cv-check.js';

const word = (str, x, y, w = 60, h = 9) => ({str, x, y, w, h});
const page = (text, images = [], n = 1) => ({n, width: 595, height: 842, images, text});
const body = 'Led the migration of forty services to Kubernetes and cut the monthly infrastructure bill by a third. '.repeat(6);
const good = () => [page([
  word('Ada Tester', 20, 30), word('ada@example.com', 20, 60), word('+41 79 555 01 23', 200, 60),
  word('Experience', 20, 100), word('Platform Engineer', 20, 120), word('Mar 2024 – Present', 20, 135),
  word(body, 20, 150, 500), word('Education', 20, 300), word('BSc Computer Science', 20, 315), word('Skills', 20, 350), word('Kubernetes, Terraform', 20, 365)])];

test('a plain one-column CV reads cleanly', () => {
  const result = analyse(good());
  assert.equal(result.score, 100, result.checks.filter(c => c.status !== 'pass').map(c => `${c.id}: ${c.detail}`).join('; '));
  assert.match(result.verdict, /Easy/);
  assert.equal(linesOf(good())[0], 'Ada Tester');
});

test('each thing a parser trips on costs points and says how to fix it', () => {
  const pages = good();
  pages[0].text = pages[0].text.filter(item => !/ada@|\+41|Education|Skills/.test(item.str));                                                  // no email, phone, education, skills
  pages[0].images = [{x: 530, y: 20, w: 40, h: 40}, {x: 0, y: 700, w: 595, h: 140}];                                                         // a photo and a banner
  pages.push(page([word('Page two', 20, 30)], [], 2), page([word('Page three', 20, 30)], [], 3));
  const result = analyse(pages), byId = Object.fromEntries(result.checks.map(c => [c.id, c]));
  for (const id of ['email', 'phone', 'education', 'skills', 'images', 'length']) { assert.notEqual(byId[id].status, 'pass', id); assert.ok(byId[id].fix, `${id} has a fix`); }
  assert.ok(result.score < 75 && /Risky/.test(result.verdict), `score ${result.score}`);
});

test('a picture of a CV has no text and fails hard', () => {
  const result = analyse([page([word('x', 20, 20)], [{x: 0, y: 0, w: 595, h: 842}])]);
  assert.equal(result.checks.find(c => c.id === 'text').status, 'fail');
  assert.ok(result.score <= 60);
});

test('two columns of sentences are read straight across, and said so', () => {
  const rows = Array.from({length: 6}, (_, i) => [word('Built and ran the platform for payments across regions', 20, 100 + i * 14, 250), word('Mentored four engineers and owned the on-call rota', 320, 100 + i * 14, 250)]).flat();
  const result = analyse([page([...good()[0].text, ...rows])]);
  assert.equal(result.checks.find(c => c.id === 'columns').status, 'warn');
});

test('dates in two styles, and icon-font symbols, are flagged', () => {
  const pages = good();
  pages[0].text.push(word('03/2022 – 02/2024', 20, 400), word(' Docker', 20, 420));
  const byId = Object.fromEntries(analyse(pages).checks.map(c => [c.id, c]));
  assert.equal(byId.dates.status, 'warn');
  assert.equal(byId.symbols.status, 'warn');
});

test('the content review is clamped, trimmed and priced', async () => {
  const fake = {messages: {create: async request => {
    assert.match(request.messages[0].content, /<cv>[\s\S]*Ada Tester/);
    return {stop_reason: 'end_turn', usage: {input_tokens: 2000, output_tokens: 500}, content: [{type: 'text', text: JSON.stringify({
      score: 140, components: [{name: 'Evidence', score: -5, note: 'numbers'}], strengths: ['a'], missing_keywords: Array.from({length: 14}, (_, i) => `k${i}`),
      fixes: Array.from({length: 11}, (_, i) => ({where: 'Experience', issue: `i${i}`, suggestion: 's', impact: 'high'}))})}]};
  }}};
  const result = await review({}, '', 'Ada Tester\nExperience', {client: fake});
  assert.equal(result.score, 100);
  assert.equal(result.components[0].score, 0);
  assert.equal(result.fixes.length, 8);
  assert.equal(result.missing_keywords.length, 10);
  assert.equal(result.usd, 0.01);
});

test('the result belongs to one PDF: another CV starts clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-check-'));
  const storage = {path: (...parts) => path.join(dir, ...parts)};
  fs.writeFileSync(storage.path('cv.pdf'), 'ONE');
  assert.equal(saved(storage), null);
  save(storage, {ats: {score: 88}});
  assert.equal(saved(storage).ats.score, 88);
  save(storage, {ai: {score: 70}});
  assert.deepEqual([saved(storage).ats.score, saved(storage).ai.score], [88, 70]);   // the parts add up
  fs.writeFileSync(storage.path('cv.pdf'), 'TWO');
  assert.equal(saved(storage), null);
  assert.notEqual(hashOf(storage), '');
});

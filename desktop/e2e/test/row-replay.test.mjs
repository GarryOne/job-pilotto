// lib/row-replay.mjs, the parts that need no browser: a pool row is found by its name (the newest day first) or its folder, and its recorded journey is read as
// pages and frames under their own addresses (no query string) plus the stylesheets of styles.har.json. The replay itself: e2e/test/row-replay-guard.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {addressOf, findRow, missParts, rowFiles, staleCapture} from '../lib/row-replay.mjs';

const write = (file, text) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); };
const caseIn = (dir, pages) => { write(path.join(dir, 'case.json'), JSON.stringify({pages})); for (const page of pages) write(path.join(dir, page.file), `<p>${page.url}</p>`); };

test('a row is found by its pool name in the newest day that has it, or by its case folder; nothing found is ""', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-rows-'));
  caseIn(path.join(root, '2026-10-10', 'hellofresh-careers-greenhouse'), [{url: 'https://a.example/old', file: 'page.html'}]);
  caseIn(path.join(root, '2026-10-11', 'hellofresh-careers-greenhouse'), [{url: 'https://a.example/new', file: 'page.html'}]);
  fs.mkdirSync(path.join(root, '2026-10-12', 'hellofresh-careers-greenhouse'), {recursive: true});   // a folder without case.json is not a row
  assert.equal(findRow('HelloFresh careers (Greenhouse', root), path.join(root, '2026-10-11', 'hellofresh-careers-greenhouse'));
  assert.equal(findRow(path.join(root, '2026-10-10', 'hellofresh-careers-greenhouse'), root), path.join(root, '2026-10-10', 'hellofresh-careers-greenhouse'));
  assert.equal(findRow('nowhere', root), '');
  assert.equal(findRow('x', path.join(root, 'missing')), '');
});

test('a row\'s journey: every page and frame under its own address, and the stylesheets; the first main page starts it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-row-'));
  caseIn(dir, [{url: 'https://jobs.example.org/frame?x=1', file: 'pages/0.html', frameOf: 'https://jobs.example.org/job'},
    {url: 'https://jobs.example.org/job/', file: 'pages/1.html'}, {url: 'https://jobs.example.org/apply#top', file: 'pages/2.html'}]);
  write(path.join(dir, 'styles.har.json'), JSON.stringify({log: {entries: [{request: {url: 'https://cdn.example.org/s.css?v=3'}, response: {content: {text: 'h1{color:red}'}}}]}}));
  const {start, documents, sheets} = rowFiles(dir);
  assert.equal(start.url, 'https://jobs.example.org/job/');
  assert.deepEqual([...documents.keys()].sort(), ['https://jobs.example.org/apply', 'https://jobs.example.org/frame', 'https://jobs.example.org/job']);
  assert.equal(sheets.get('https://cdn.example.org/s.css'), 'h1{color:red}');
  assert.equal(addressOf('https://a.example/x/?q=1#h'), 'https://a.example/x');
  assert.throws(() => rowFiles(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-row-empty-'))), /no recorded pages/);
});

test('a page is first served as the extension saw it at its ask, when the live run kept that state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-row-ask-'));
  write(path.join(dir, 'pages/1.html'), 'settled'); write(path.join(dir, 'pages/2.html'), 'at the ask');
  write(path.join(dir, 'case.json'), JSON.stringify({pages: [{url: 'https://a.example/p', file: 'pages/1.html', at: 1, state: 0}, {url: 'https://a.example/p', file: 'pages/2.html', at: 2, state: 1, ask: true}]}));
  assert.equal(rowFiles(dir).documents.get('https://a.example/p'), 'at the ask');
});

test('a capture from before the replay format (no window size or ask state on its pages) is named stale, with what to do; a current one is not', () => {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-row-old-'));
  caseIn(old, [{url: 'https://a.example/p', file: 'page.html'}]);
  assert.match(staleCapture(old), /predates the replay format.*npm run smoke -- --only/);
  const current = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-row-new-'));
  write(path.join(current, 'pages/1.html'), '<p>x</p>');
  write(path.join(current, 'case.json'), JSON.stringify({pages: [{url: 'https://a.example/p', file: 'pages/1.html', at: 1, state: 0, ask: true, view: {width: 1200, height: 818, doc: 5}}]}));
  assert.equal(staleCapture(current), '');
});

test('a miss names the parts that differ from the nearest kept ask, read from the app log, without repeats', () => {
  const log = 'x model memo: not in the row\'s kept answers (an offline replay never asks the model); the nearest kept ask differs in: user:job, system:1\ny model memo: not in the row\'s kept answers; the nearest kept ask differs in: user:job\n';
  assert.deepEqual(missParts(log), ['user:job', 'system:1']);
  assert.deepEqual(missParts('the nearest kept ask differs in: system:1, system:1:profile (lines 33-34, 2 in all of 50), user:job'), ['system:1', 'system:1:profile (lines 33-34, 2 in all of 50)', 'user:job'], 'a line list inside parentheses is one part');
  assert.deepEqual(missParts('model memo: not in the row\'s kept answers (an offline replay never asks the model)'), [], 'an old memo (no parts kept): nothing to name');
});

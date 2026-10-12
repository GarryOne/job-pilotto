// The one door every give-up goes through (extension/ladder/dead-end.js; spec 2026-10-12-one-next-move.md phase 2 box 1): a stuck() call anywhere else in the extension fails here,
// the report sent is today's, and the evidence logged beside it keeps our own facts only, never the page's words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {deadEnd, evidenceOf, useReporter} from '../../extension/ladder/dead-end.js';

const EXTENSION = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../extension');
const jsFiles = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? jsFiles(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []));

test('no file reports a give-up but through the door: stuck() is called nowhere, only handed to deadEnd once', () => {
  const calls = [];
  for (const file of jsFiles(EXTENSION)) {
    const code = fs.readFileSync(file, 'utf8').split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');   // comments may name it
    for (const found of code.matchAll(/(?<![\w.])stuck\s*\(/g)) {
      const before = code.slice(Math.max(0, found.index - 30), found.index);
      if (/export async function\s*$/.test(before)) continue;   // its definition (fill-flow.js)
      calls.push(`${path.relative(EXTENSION, file)}: ${code.slice(found.index, found.index + 60).split('\n')[0]}`);
    }
  }
  assert.deepEqual(calls, [], 'report a give-up with deadEnd (extension/ladder/dead-end.js), never stuck() directly');
  const flow = fs.readFileSync(path.join(EXTENSION, 'fill-flow.js'), 'utf8');
  assert.equal((flow.match(/useReporter\(stuck\)/g) || []).length, 1, 'fill-flow.js hands stuck to the door once');
});

test('the door sends today\'s report unchanged, names the ending in the log, and keeps an unknown reason as no-form', async () => {
  const sent = [], logged = [];
  useReporter(async (...args) => { sent.push(args); });
  const decide = (area, what, data) => logged.push({area, what, data});
  await deadEnd({job: 'https://jobs.example/1', host: 'jobs.example', why: 'site_broken', tabId: 3, page: 'https://jobs.example/1#m', needs: 'This posting is gone: the site answered 404'}, {kind: 'gone', status: 404}, decide);
  await deadEnd({job: 'https://jobs.example/2', host: 'jobs.example', why: 'account', tabId: 3, page: 'https://jobs.example/2', needs: '', accountStep: 'sign_in'}, {reason: 'no way forward on this page'}, decide);
  await deadEnd({job: 'https://jobs.example/3', host: 'jobs.example', why: 'something new', tabId: 3, page: 'https://jobs.example/3'}, {}, decide);
  assert.deepEqual(sent, [
    ['https://jobs.example/1', 'jobs.example', 'site_broken', 3, 'https://jobs.example/1#m', 'This posting is gone: the site answered 404', ''],
    ['https://jobs.example/2', 'jobs.example', 'account', 3, 'https://jobs.example/2', '', 'sign_in'],
    ['https://jobs.example/3', 'jobs.example', 'no-form', 3, 'https://jobs.example/3', '', '']]);
  assert.deepEqual(logged.map(line => line.what), ['dead end: site_broken', 'dead end: account', 'dead end: no-form']);
  assert.deepEqual(logged.map(line => line.data.ending), ['site_broken', 'unresolved', 'unresolved']);
  assert.deepEqual(logged[0].data, {host: 'jobs.example', ending: 'site_broken', named: true, kind: 'gone', status: 404});
  assert.equal(logged[1].data.named, false);
});

test('evidence keeps numbers, booleans and short words of ours; page text, addresses and long strings never', () => {
  assert.deepEqual(evidenceOf({role: 'no-form', rung: 2, signal: 'confident', botCheck: true, left: 3, missing: undefined, nope: null}), {role: 'no-form', rung: 2, signal: 'confident', botCheck: true, left: 3});
  const dropped = evidenceOf({need: 'Send your CV to jane@company.example', url: 'https://jobs.example/1?x=1', long: 'x'.repeat(41), list: ['a'], 'bad-key': 1, nan: Number.NaN, quote: 'Bitte "bewerben" Sie sich'});
  assert.deepEqual(dropped, {});
});

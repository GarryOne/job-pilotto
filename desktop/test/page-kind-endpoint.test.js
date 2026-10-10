// The app's page-kind endpoint (lib/server-pages.js decidePageKind) is the boundary between the extension's sketch and the AI. SmartRecruiters (twin,
// 9 Oct 2026): the sketch carried the bot-check frame's host, but the endpoint passed only url/title/headings/controls/buttons on, so the AI never saw
// it, and botCheck never came back. This test goes through the endpoint, not pageKind alone (the gap the first test missed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {decidePageKind} from '../lib/server-pages.js';

test('the endpoint passes the frames to the decision and returns its bot check', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-endpoint-'));
  const storage = {path: name => path.join(dir, name), settings: () => ({})};
  const seen = [];
  const decide = async (client, raw) => { seen.push(raw); return {kind: 'other', role: 'no-form', by: 'ai', confidence: 0.9, shape: 'x', botCheck: true}; };
  const reply = await decidePageKind(storage, {url: 'https://jobs.example.test/apply/1', title: 'Apply', headings: [], controls: [], buttons: [], frames: ['check.example.test']}, {decide, client: null});
  assert.deepEqual(seen[0].frames, ['check.example.test'], 'the frames reach the decision');
  assert.equal(reply.botCheck, true, 'the bot check reaches the extension');
  const plain = await decidePageKind(storage, {url: 'https://jobs.example.test/apply/2', frames: []}, {decide: async () => ({kind: 'form', role: 'form', by: 'ai', confidence: 0.9, shape: 'y'}), client: null});
  assert.equal('botCheck' in plain, false);
});

test('the endpoint passes the sketch\'s address lines to the decision and returns the email outcome (the gap the first email test missed)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-endpoint-'));
  const storage = {path: name => path.join(dir, name), settings: () => ({})};
  const seen = [];
  const decide = async (client, raw) => { seen.push(raw); return {kind: 'posting', role: 'no-form', by: 'ai', confidence: 0.9, shape: 'x', applyBy: 'email', applyEmail: 'jobs@firma.ch'}; };
  const reply = await decidePageKind(storage, {url: 'https://firma.ch/jobs/1', title: 'Job', headings: [], controls: [], buttons: [], frames: [], mails: ['Bewerbung an jobs@firma.ch']}, {decide, client: null});
  assert.deepEqual(seen[0].mails, ['Bewerbung an jobs@firma.ch'], 'the address lines reach the decision');
  assert.deepEqual([reply.applyBy, reply.applyEmail], ['email', 'jobs@firma.ch'], 'the outcome reaches the extension');
});

// One list of sketch fields (lib/page-kind.js SKETCH_FIELDS): the endpoint forwards exactly these, so a field the extension adds can no longer be forgotten here
// (frames, 9 Oct 2026; mails, 10 Oct 2026). The extension's side is checked in e2e/test/real-extension.test.mjs ("the page sketch the extension sends").
import {SKETCH_FIELDS} from '../lib/page-kind.js';
test('the endpoint forwards every field of the shared sketch list to the decision, and nothing else', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-endpoint-'));
  const storage = {path: name => path.join(dir, name), settings: () => ({})};
  const seen = [];
  const decide = async (client, raw) => { seen.push(raw); return {kind: 'other', role: 'no-form', by: 'ai', confidence: 0.9, shape: 'x'}; };
  const body = {url: 'https://jobs.example.test/apply/9', secret: 'must-not-pass', ...Object.fromEntries(SKETCH_FIELDS.map(name => [name, [`marker-${name}`]]))};
  await decidePageKind(storage, body, {decide, client: null});
  for (const name of SKETCH_FIELDS) assert.deepEqual(seen[0][name], [`marker-${name}`], `${name} reaches the decision`);
  assert.equal('secret' in seen[0], false, 'a field outside the list is not forwarded');
  assert.ok(SKETCH_FIELDS.includes('mails') && SKETCH_FIELDS.includes('frames'));
});

test('the endpoint passes a digest request to the decision and returns the rung, the signal and the digest to the extension', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-endpoint-'));
  const storage = {path: name => path.join(dir, name), settings: () => ({})};
  const asked = [];
  const decide = async (client, raw, cache, options) => { asked.push(options); return {kind: 'posting', role: 'no-form', by: 'digest', confidence: 0.9, shape: 's', rung: 3, signal: 'confident',
    digest: {outcome: 'phone', verb: 'tell_person', numbers: [3], chosen: [{n: 3, kind: 'phone', position: 'main', text: '044 555 01 00'}]}}; };
  const reply = await decidePageKind(storage, {url: 'https://firma.ch/jobs/2', digest: true, candidates: [{n: 3, kind: 'phone', position: 'main', text: '044 555 01 00'}]}, {decide, client: null});
  assert.equal(asked[0].digest, true, 'the request reaches the decision');
  assert.deepEqual([reply.rung, reply.signal, reply.digest.outcome], [3, 'confident', 'phone']);
  const plain = await decidePageKind(storage, {url: 'https://firma.ch/jobs/3'}, {decide: async () => ({kind: 'form', role: 'form', by: 'ai', confidence: 0.9, shape: 'y', rung: 2, signal: 'confident'}), client: null});
  assert.deepEqual([plain.rung, plain.signal, 'digest' in plain], [2, 'confident', false]);
  const unsure = await decidePageKind(storage, {url: 'https://firma.ch/jobs/4'}, {decide: async () => ({error: 'unsure (0.4)', kind: 'other', shape: 'z', rung: 2, signal: 'unsure'}), client: null});
  assert.deepEqual([unsure.error, unsure.rung, unsure.signal], ['unsure (0.4)', 2, 'unsure']);
});

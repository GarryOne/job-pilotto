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

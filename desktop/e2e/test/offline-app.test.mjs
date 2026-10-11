// The app's own extension server offline for a row replay (lib/offline-app.mjs): starts in seconds on its own port in a temp folder, answers the extension as a
// person's app does (the fake applicant and the fixture CV, never the person's), refuses every host but this computer, and stops with nothing left running.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {startOfflineApp} from '../lib/offline-app.mjs';

const REAL = path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto');

test('the offline app answers the extension with the fake applicant, on its own port and folder, and stops cleanly', async () => {
  const started = Date.now();
  const app = await startOfflineApp();
  try {
    assert.ok(Date.now() - started < 15000, `started in ${Date.now() - started} ms`);
    assert.notEqual(app.port, 47111);
    assert.ok(!(path.resolve(app.dir) + path.sep).startsWith(REAL + path.sep), 'never the app\'s real folder');
    const me = await (await fetch(`${app.url}/extension/me`, {headers: {authorization: `Bearer ${app.token}`}})).json();
    assert.equal(me.contact?.email, 'test.candidate@example.com', JSON.stringify(me).slice(0, 300));
    assert.equal(me.contact?.first_name ?? me.contact?.firstName ?? me.contact?.['first name'], 'Test');
    assert.ok(me.resume?.data?.length > 1000, 'the fixture CV');
    assert.equal(fs.readFileSync(path.join(app.dir, 'cv.pdf')).equals(fs.readFileSync(new URL('../fixtures/cv.pdf', import.meta.url))), true);
    const refused = await fetch(`${app.url}/extension/me`, {headers: {authorization: 'Bearer wrong'}});
    assert.equal(refused.status, 401);
  } finally { await app.close(); }
  await assert.rejects(fetch(`${app.url}/extension/me`), 'nothing is left listening');
});

test('inside the offline app, a call to any host but this computer is refused and named (checked before it serves)', async () => {
  const app = await startOfflineApp();
  try { assert.equal(app.guarded, true); } finally { await app.close(); }
});

test('the offline app never asks the model by default: a page-kind ask outside the kept answers is refused, not answered by claude -p', async () => {
  const app = await startOfflineApp();
  try {
    const body = {url: 'https://jobs.example.org/x', title: 'x', headings: ['x'], controls: [], buttons: ['Apply'], frames: []};
    const answer = await (await fetch(`${app.url}/extension/page-kind`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${app.token}`,
      origin: `chrome-extension://${app.extensionId}`}, body: JSON.stringify(body)})).json();
    assert.ok(!answer.kind || answer.by !== 'ai', `no AI answer: ${JSON.stringify(answer).slice(0, 200)}`);
    assert.match(app.logText() + JSON.stringify(answer), /not in the row's kept answers/);
  } finally { await app.close(); }
});

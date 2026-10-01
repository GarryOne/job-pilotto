// The Apply button makes a form session (no terminal): one per job, in the Applying page, moved to Applying in Notion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as apply from '../lib/apply.js';
import * as terminals from '../lib/terminals.js';

const URL1 = 'https://jobs.ashbyhq.com/openai/621bb104-9daa-4c9e-949a-03d5730334e8';
const harness = () => {
  terminals._reset();
  const opened = [], ran = [];
  return {opened, ran, options: {open: (...args) => { opened.push(args); return {unref() {}}; }, term: terminals, run: async (_, args) => { ran.push(args); return {}; }, id: () => 'f1'}};
};

test('Apply opens the form tab and makes one form session for the job, marked Applying', async () => {
  const {opened, ran, options} = harness();
  const result = await apply.applyOne({}, URL1, {title: 'Software Engineer', company: 'OpenAI', location: 'London'}, options);
  assert.equal(result.ok, true);
  assert.equal(opened.length, 1);
  assert.ok(opened[0].flat(2).some(part => String(part).endsWith('#jobpilotto-fill')));
  const [session] = terminals.list();
  assert.deepEqual([session.kind, session.id, session.company, session.status, session.live, session.url], ['form', 'f1', 'OpenAI', 'done', false, URL1]);
  assert.deepEqual(ran, [['src.ai.apply_batch', '--mark-applying', URL1]]);
});

test('Apply again on the same job reopens the tab only: still one session, no second Notion write', async () => {
  const {opened, ran, options} = harness();
  await apply.applyOne({}, URL1, {company: 'OpenAI'}, options);
  await apply.applyOne({}, URL1, {company: 'OpenAI'}, {...options, id: () => 'f2'});
  assert.equal(opened.length, 2);
  assert.equal(terminals.list().length, 1);
  assert.equal(ran.length, 1);
});

test('a job without a link opens nothing and makes no session', async () => {
  const {opened, options} = harness();
  const result = await apply.applyOne({}, '', {}, options);
  assert.equal(result.ok, false);
  assert.equal(opened.length + terminals.list().length, 0);
});

test('a form session is kept on disk as a form session and comes back after a restart', () => {
  terminals._reset();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'form-session-')), 'sessions.json');
  terminals.persist(file);
  terminals.startForm({id: 'f1', url: URL1, company: 'OpenAI', title: 'SE'});
  terminals.saveNow();
  terminals._sessions.clear();
  terminals.restore();
  const [session] = terminals.list();
  assert.deepEqual([session.kind, session.status, session.company], ['form', 'done', 'OpenAI']);
});

test('a form session never reports to the Claude run statistics', () => {
  terminals._reset();
  const heard = [];
  terminals.onStatus(view => heard.push(view.id));
  terminals.startForm({id: 'f1', url: URL1, company: 'OpenAI'});
  terminals.setOutcome('f1', 'submitted');
  terminals.onStatus(() => {});
  assert.deepEqual(heard, []);
  assert.equal(terminals.get('f1').outcome, 'submitted');
});

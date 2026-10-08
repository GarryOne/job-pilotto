// The "Which job is this email about?" popup: three explicit answers (a tracked job, a new job, not a job), the job picker
// only for the first, and the same "why" sentence as the Gmail card (owner's mockup, 6 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {CHOICES, emailNoun, questionWhy} from '../renderer/question-words.js';
import {activitySource} from './activity-source.js';

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer');

test('the dialog offers the three answers as radios, and the picker holds only tracked jobs', () => {
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
  const dialog = /<dialog id="reassign-dialog"[\s\S]*?<\/dialog>/.exec(html)[0];
  const values = [...dialog.matchAll(/type="radio" name="reassign-choice" value="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(values, ['tracked', 'new', 'none']);
  assert.deepEqual(Object.keys(CHOICES), values);
  assert.match(dialog, /id="reassign-pick" hidden/);
  const js = fs.readFileSync(path.join(renderer, 'pages/reassign.js'), 'utf8');
  assert.doesNotMatch(js, /option\('(new|none)'/, 'a new job / not a job are choices, not picker entries');
});

test('each answer says what Save does', () => {
  assert.equal(CHOICES.new.save, 'Create job & link email');
  assert.equal(CHOICES.new.note, 'This email will be linked to the new job.');
  assert.equal(CHOICES.tracked.save, 'Link email');
});

test('why it is asked: what the email names, the same words on the card and in the popup', () => {
  assert.equal(emailNoun({subject: 'Invitation from an unknown sender: Igor and Kraken DM @ Thu 8 Oct'}), 'invitation');
  assert.equal(emailNoun({subject: 'Re: your application'}), 'email');
  assert.equal(questionWhy('invitation', 'Kraken'), "The invitation names Kraken but doesn't specify the role.");
  assert.match(questionWhy('email', ''), /couldn't tell which job/);
  const activity = activitySource();
  assert.match(activity, /questionWhy\(noun, company\)/);
});

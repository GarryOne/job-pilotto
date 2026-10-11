// Recorded pages (e2e/recorded) go into this PUBLIC repo: no personal data may be in them (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md).
// Everywhere: only example.* emails, no phone numbers, no typed values (value="…"), no URL query strings (sign-in states, tokens).
// On a Mac with the app: none of the person's own values either (emails, phones and names from profile.md / answers.md). A failure names the kind, never the value.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {appProfileTexts, personalValues} from '../e2e/lib/capture-page.mjs';
import {privacyFindings} from '../e2e/lib/row-case-gates.mjs';   // one function for this test and for npm run row-to-case's own gate

const REPLAY = new URL('../e2e/recorded/', import.meta.url);
const files = () => Object.fromEntries(fs.existsSync(REPLAY) ? fs.readdirSync(REPLAY).flatMap(dir => {
  const folder = new URL(`${dir}/`, REPLAY);
  return fs.statSync(folder).isDirectory() ? fs.readdirSync(folder).map(name => [`${dir}/${name}`, fs.readFileSync(new URL(name, folder), 'utf8')]) : [];
}) : []);

test('recorded pages hold no email but example.*, no phone, no typed value, no URL query', () => {
  assert.deepEqual(privacyFindings(files()), []);
});

test('on this Mac: none of the person\'s own values (from the app\'s profile) is in a recorded page', {skip: !fs.existsSync(path.join(os.homedir(), 'Library/Application Support/Job Pilotto/profile.md')) && 'no app profile on this computer'}, () => {
  assert.deepEqual(privacyFindings(files(), personalValues(appProfileTexts())), []);   // e2e/lib/capture-page.mjs: the same extraction the capture scrubs with
});

// The CV caption must not promise a read on the first Tailor CV once the read has failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cvStateText } from '../renderer/cv-state.js';

test('failed read drops the "first Tailor CV" promise', () => {
  assert.match(cvStateText({ base: false }, false), /first Tailor CV/);
  assert.doesNotMatch(cvStateText({ base: false }, true), /Tailor CV/);
  assert.match(cvStateText({ base: true, custom: true }, true), /ready · your design/);
});

test('the page records a failed read and uses the helper', () => {
  const src = fs.readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8');
  assert.match(src, /cvStateText\(status, shared\.cvReadFailed\)/);
  assert.match(src, /shared\.cvReadFailed = !result\.ok/);
});

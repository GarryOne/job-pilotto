import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {consume, FILE} from '../lib/install-source.js';

function setup(text, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-source-'));
  if (text != null) fs.writeFileSync(path.join(dir, FILE), text);
  const saved = {...settings};
  return {dir, saved, storage: {settings: () => saved, saveSettings: patch => Object.assign(saved, patch)}};
}

test('the channel the installer left is taken once and kept', () => {
  const {dir, saved, storage} = setup('Reddit-DevOps\n');
  assert.equal(consume(dir, storage), 'reddit-devops');
  assert.equal(saved.installSource, 'reddit-devops');
  assert.equal(fs.existsSync(path.join(dir, FILE)), false);
  assert.equal(consume(dir, storage), null);
});

test('the first channel stays: a later install through another link does not change it', () => {
  const {dir, saved, storage} = setup('hn', {installSource: 'linkedin-post'});
  assert.equal(consume(dir, storage), null);
  assert.equal(saved.installSource, 'linkedin-post');
  assert.equal(fs.existsSync(path.join(dir, FILE)), false);
});

test('nothing left, or something that is not a channel label: nothing is stored', () => {
  for (const text of [null, '', 'a b', 'https://evil.example/x', 'x'.repeat(41)]) {
    const {dir, saved, storage} = setup(text);
    assert.equal(consume(dir, storage), null);
    assert.equal(saved.installSource, undefined);
  }
});

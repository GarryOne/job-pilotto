import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {attribute, consume, FILE} from '../lib/install-source.js';

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

test('a downloaded app asks once which channel its download click came from, and keeps the label', async () => {
  const {storage, saved} = setup(null), asked = [];
  const fetcher = async url => { asked.push(url); return Response.json({source: 'LinkedIn.com'}); };
  assert.equal(await attribute(storage, {platform: 'darwin', fetcher}), 'linkedin.com');
  assert.equal(saved.installSource, 'linkedin.com');
  assert.match(asked[0], /\/api\/attribution\?platform=mac$/);
  assert.equal(await attribute(storage, {platform: 'darwin', fetcher}), null);
  assert.equal(asked.length, 1, 'never asked again');
});

test('the installer\'s channel wins; no answer, a bad label or a failure leaves none and is not retried', async () => {
  const fetcher = async () => { throw new Error('should not ask'); };
  assert.equal(await attribute(setup(null, {installSource: 'reddit-devops'}).storage, {platform: 'darwin', fetcher}), null);
  for (const answer of [async () => Response.json({source: null}), async () => Response.json({source: '<script>'}),
    async () => new Response('', {status: 500}), async () => { throw new Error('offline'); }]) {
    const {storage, saved} = setup(null);
    assert.equal(await attribute(storage, {platform: 'win32', fetcher: answer}), null);
    assert.equal(saved.installSource, undefined);
    assert.equal(saved.installSourceAsked, true);
  }
  assert.equal(await attribute(setup(null).storage, {platform: 'linux', fetcher}), null);
});

// The user's workflows call the engine by the name GitHub gives it now (lib/engine-repo.js): a renamed repo's `uses:` is not
// redirected (proved 24 Oct 2026), so every template that names the engine must follow a rename, and the user's repo is found by both names.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as github from '../lib/github.js';
import {createStorage} from '../lib/storage.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {status});
const named = full_name => async url => (new URL(url).pathname === `/repos/${github.ENGINE_REPO}` ? json({full_name}) : json({}, 404));

function storage() {
  const st = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-engine-')), {encrypt: v => v, decrypt: v => v});
  st.saveSettings({cloud: {repo: 'me/jobadabra-personal-always-on'}});
  return st;
}
// The lines GitHub reads (comments left out): what a workflow runs.
const live = text => text.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');

test('every template that names the engine follows its new name and stays pinned to the app release', async () => {
  github.setEngineRef('desktop-v1.2.3');
  try {
    assert.equal(await github.resolveEngineRepo(named('GarryOne/jobadabra')), true);
    assert.equal(github.currentEngineRepo(), 'GarryOne/jobadabra');
    const files = Object.entries(github.payload(storage()).files).filter(([name]) => name.startsWith('.github/workflows/'));
    assert.ok(files.length >= 3, 'the daily, mail and scout templates');
    for (const [name, text] of files) {
      const body = live(text);
      assert.doesNotMatch(body, /GarryOne\/job-pilotto(?![\w.-]*-starter)/, `${name} still names the old engine repo`);
      for (const [, repo, ref] of body.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)\/\.github\/workflows\/[\w.-]+\.yml@([\w.-]+)/g)) {
        assert.equal(repo, 'GarryOne/jobadabra', name);
        assert.equal(ref, 'desktop-v1.2.3', name);
      }
      for (const [, repo] of body.matchAll(/code_repository:\s*(\S+)/g)) assert.equal(repo, 'GarryOne/jobadabra', name);
    }
  } finally {
    await github.resolveEngineRepo(named(github.ENGINE_REPO));
    github.setEngineRef('main');
  }
  assert.equal(github.currentEngineRepo(), github.ENGINE_REPO);
});

test('offline, a refusal or a strange answer keeps the last engine name', async () => {
  assert.equal(await github.resolveEngineRepo(async () => { throw new Error('offline'); }), false);
  assert.equal(await github.resolveEngineRepo(async () => json({message: 'rate limited'}, 403)), false);
  assert.equal(await github.resolveEngineRepo(named('not a repo name')), false);
  assert.equal(github.currentEngineRepo(), github.ENGINE_REPO);
});

test('the user\'s repo is found by its new name and by the name it had before 24 Oct 2026', async () => {
  for (const name of github.REPO_NAMES) {
    const api = async (method, route) => {
      if (route === '/user') return {login: 'me'};
      if (route.startsWith('/user/installations?')) return {installations: [{id: 1}]};
      return {repositories: [{full_name: 'me/notes', name: 'notes', private: true}, {full_name: `me/${name}`, name, private: true}]};
    };
    assert.equal((await github.findRepo(api)).repo, `me/${name}`);
  }
  assert.match(github.CREATE_URL, /name=jobadabra-personal-always-on&/);
});

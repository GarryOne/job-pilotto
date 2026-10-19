// The Jobadabra rename must not move an existing install's data folder or the Keychain item that seals its tokens (both follow app.name).
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {keepLegacyIdentity, LEGACY_NAME} from '../lib/app-identity.js';

function fakeApp() {
  const log = [];
  let ready;
  const app = {
    name: 'Jobadabra', paths: {appData: path.join('/home', 'Application Support')},
    setName(name) { app.name = name; log.push(`name:${name}`); },
    getPath: kind => app.paths[kind], setPath(kind, value) { app.paths[kind] = value; },
    whenReady: () => new Promise(resolve => { ready = resolve; }),
  };
  return {app, log, ready: () => ready()};
}

test('data folder stays "Job Pilotto"; the Keychain item is sealed under the old name, then the app shows Jobadabra', async () => {
  const {app, log, ready} = fakeApp();
  const safeStorage = {isEncryptionAvailable: () => true, encryptString: () => { log.push(`seal under:${app.name}`); return Buffer.from('x'); }};
  keepLegacyIdentity({app, safeStorage});
  assert.equal(app.paths.userData, path.join('/home', 'Application Support', LEGACY_NAME));
  assert.equal(app.name, LEGACY_NAME);
  ready(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(log, ['name:Job Pilotto', 'seal under:Job Pilotto', 'name:Jobadabra']);
});

test('a machine without a keychain still ends up named Jobadabra', async () => {
  const {app, ready} = fakeApp();
  keepLegacyIdentity({app, safeStorage: {isEncryptionAvailable: () => { throw new Error('no keyring'); }}});
  ready(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.name, 'Jobadabra');
});

test('a test or demo folder set afterwards still wins', () => {
  const {app} = fakeApp();
  keepLegacyIdentity({app, safeStorage: {}});
  app.setPath('userData', '/tmp/demo');
  assert.equal(app.getPath('userData'), '/tmp/demo');
});

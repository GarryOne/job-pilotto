// The browsers' own records say whether the Job Pilotto extension is installed (lib/extension-install.js): instant,
// and still true with Chrome closed. The unpacked extension's ID is Chrome's own hash of its path, which is what
// lets the app open its options page without asking the browser anything.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as ext from '../lib/extension-install.js';

const record = (name, extra = {}) => ({manifest: {name, version: '0.8.16'}, path: '/app/extension', location: 4,
  disable_reasons: [], ...extra});
const prefs = settings => JSON.stringify({extensions: {settings}});
// A browser whose <profile>/Secure Preferences is the given JSON, and which has nothing else.
const fake = (files, list = () => ['Default']) => ({
  list,
  exists: at => Object.keys(files).some(key => at.endsWith(key)),
  read: at => { const key = Object.keys(files).find(k => at.endsWith(k)); if (!key) throw new Error(`no ${at}`); return files[key]; },
});

test('the Job Pilotto record in a browser profile is found; other extensions are not', () => {
  const files = {
    'Default/Secure Preferences': prefs({
      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: record('Job Pilotto'),
      bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: record('Gemini in Chrome', {location: 5, path: '/Chrome.app/glic'}),
    }),
    'Profile 1/Secure Preferences': prefs({cccccccccccccccccccccccccccccccc: record('Something Else')}),
  };
  const io = fake(files, () => ['Default', 'Profile 1']);
  assert.deepEqual(ext.inProfile('/support/Google/Chrome', io), [
    {profile: 'Default', version: '0.8.16', folder: '/app/extension', enabled: true, unpacked: true},
  ]);
});

test('a turned-off extension is found and said to be off', () => {
  const io = fake({'Default/Secure Preferences': prefs({aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: record('Job Pilotto', {disable_reasons: [1]})})});
  assert.equal(ext.inProfile('/support/Google/Chrome', io)[0].enabled, false);
});

test('older browsers keep it in Preferences, which is read too', () => {
  const io = fake({'Default/Preferences': prefs({aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: record('Job Pilotto')})});
  assert.equal(ext.inProfile('/support/Chromium', io).length, 1);
});

test('every browser that has it is listed, and the copy loaded from our folder is marked current', () => {
  const io = {
    exists: at => at === '/support/Google/Chrome' || at === '/support/BraveSoftware/Brave-Browser'
      || at.endsWith('/Default/Secure Preferences'),
    read: at => prefs(at.includes('Brave') ? {bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: record('Job Pilotto', {path: '/Users/x/Desktop/extension'})}
      : {aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: record('Job Pilotto')}),
  };
  const found = ext.installed({folder: '/app/extension', support: '/support', read: io.read, exists: io.exists,
    browsers: [{name: 'Google Chrome', dir: 'Google/Chrome', app: 'Google Chrome'},
      {name: 'Brave', dir: 'BraveSoftware/Brave-Browser', app: 'Brave Browser'},
      {name: 'Vivaldi', dir: 'Vivaldi', app: 'Vivaldi'}]});
  assert.deepEqual(found.map(entry => [entry.browser, entry.current]), [['Google Chrome', true], ['Brave', false]]);
});

test('a browser is up only when pgrep finds it', async () => {
  assert.equal(await ext.running('Google Chrome', {exec: (file, args, done) => done(null, '')}), true);
  assert.equal(await ext.running('Google Chrome', {exec: (file, args, done) => done(new Error('no'))}), false);
  assert.equal(await ext.running('Brave Browser', {exec: (file, args, done) => { assert.equal(args[0], '-x'); assert.equal(args[1], 'Brave Browser'); done(null, ''); }}), true);
});

test('the unpacked extension ID is Chrome\'s own hash of the folder path', () => {
  // dflclglillobjogfddcpofopedpcmmgo is sha256('/Users/mac/job-pilotto/extension')'s first 128 bits, as a-p.
  assert.equal(ext.extensionId('/Users/mac/job-pilotto/extension'), 'dflclglillobjogfddcpofopedpcmmgo');
  assert.match(ext.extensionId('/tmp/somewhere/extension'), /^[a-p]{32}$/);
  assert.notEqual(ext.extensionId('/tmp/a/extension'), ext.extensionId('/tmp/b/extension'));
});

test('the two pages open in Chrome itself', async () => {
  const opened = [];
  const exec = (file, args, done) => { opened.push([file, args.join(' ')]); done(null, ''); };
  assert.equal(await ext.openExtensionsPage({exec}), true);
  assert.equal(await ext.openOptionsPage('/Users/mac/job-pilotto/extension', {exec}), true);
  assert.deepEqual(opened, [
    ['/usr/bin/open', '-a Google Chrome chrome://extensions'],
    ['/usr/bin/open', '-a Google Chrome chrome-extension://dflclglillobjogfddcpofopedpcmmgo/options.html'],
  ]);
});

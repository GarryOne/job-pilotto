// Settings → Credentials reads the Keychain's item attributes (never its secrets) and one password on request.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {list, parseDump, reveal} from '../lib/credentials.js';

const item = (service, {account = 'job-pilotto', comment = null, cdat = '20261008115402'} = {}) => `keychain: "/Users/x/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="Job Pilotto: x"
    "acct"<blob>="${account}"
    "cdat"<timedate>=0x32303236313030383131353430325A00  "${cdat}Z\\000"
    "icmt"<blob>=${comment === null ? '<NULL>' : `"${comment}"`}
    "svce"<blob>="${service}"
`;

test('every site account is listed with its email and job, newest first; the shared password and non-sites are not', () => {
  const dump = [
    item('job-pilotto.career5.successfactors.eu.password', {cdat: '20260928003603'}),
    item('job-pilotto.career2.successfactors.eu.password', {comment: 'email=ilie@example.com job=https://jobs.migros.ch/x'}),
    item('job-pilotto.sites.password'), item('job-pilotto.mac-sign.password'),
    item('job-pilotto.auth.jobs.ch.password', {account: 'someone-else'}), item('other.app.password'),
  ].join('');
  assert.deepEqual(parseDump(dump), [
    {host: 'career2.successfactors.eu', email: 'ilie@example.com', job: 'https://jobs.migros.ch/x', created: '2026-10-08T11:54:02Z'},
    {host: 'career5.successfactors.eu', email: '', job: '', created: '2026-09-28T00:36:03Z'},
  ]);
});

test('the list asks for attributes only, and a password is read for a plain host name only', () => {
  const calls = [];
  list('darwin', (...args) => { calls.push(args); return ''; });
  assert.deepEqual(calls[0].slice(0, 2), ['security', ['dump-keychain']]);   // no -d: no secrets in the list
  assert.equal(reveal('career2.successfactors.eu', 'darwin', () => 'Maple-Rocket-42\n'), 'Maple-Rocket-42');
  assert.equal(reveal('x; rm -rf /', 'darwin', () => 'nope'), null);
  assert.equal(reveal('a.com', 'win32', () => 'nope'), null);
  assert.equal(list('win32').ok, false);
});

test('the extension gets a site password only while applying, for a plain site host, never another item', async () => {
  const {forExtension} = await import('../lib/credentials.js');
  const read = host => (host === 'career2.successfactors.eu' ? 'Maple-Rocket-42' : null);
  assert.deepEqual(forExtension('career2.successfactors.eu', {applying: true, read}), {ok: true, password: 'Maple-Rocket-42'});
  assert.deepEqual(forExtension('career2.successfactors.eu', {applying: false, read}), {ok: false});   // no application open
  assert.deepEqual(forExtension('sites', {applying: true, read: () => 'x'}), {ok: false});            // the shared item by name
  assert.deepEqual(forExtension('mac-sign', {applying: true, read: () => 'x'}), {ok: false});         // not a site
  assert.deepEqual(forExtension('a.com"; rm', {applying: true, read: () => 'x'}), {ok: false});
  assert.deepEqual(forExtension('auth.jobs.ch', {applying: true, read}), {ok: false});                 // none yet: the app makes it
});

test('emailOf reads the email recorded on one site\'s item (attributes only) and nothing else', async () => {
  const {emailOf} = await import('../lib/credentials.js');
  const fake = out => () => out;
  assert.equal(emailOf('career2.successfactors.eu', 'darwin', fake('    "icmt"<blob>="email=me@example.com job=https://jobs.example/x"\n')), 'me@example.com');
  assert.equal(emailOf('career2.successfactors.eu', 'darwin', fake('    "icmt"<blob>=<NULL>\n')), '');
  assert.equal(emailOf('bad host!', 'darwin', fake('x')), '');
  assert.equal(emailOf('a.example', 'win32', fake('x')), '');
  assert.equal(emailOf('a.example', 'darwin', () => { throw new Error('no item'); }), '');
});

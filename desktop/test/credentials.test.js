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

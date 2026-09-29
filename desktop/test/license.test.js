// The free allowance and owner-signed license keys (lib/license.js), with keys signed by the real tools/license.py's scheme
// but a throwaway key pair here.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {allowance, check, create, open, revocations, text, FREE_APPLICATIONS} from '../lib/license.js';

const pair = crypto.generateKeyPairSync('ed25519');
const raw = keys => keys.publicKey.export({type: 'spki', format: 'der'}).subarray(-32).toString('base64url');
const publicKey = raw(pair);
const sign = (payload, prefix = 'JP1') => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${prefix}.${body}.${crypto.sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`;
};
const NOW = Date.parse('2026-10-15T12:00:00Z'), DAY = 86400000;
const days = n => new Date(NOW - n * DAY).toISOString();

test('a signed key opens; a forged, foreign or malformed one does not', () => {
  const key = sign({id: 'a1', name: 'Ana', kind: 'friend'});
  assert.deepEqual(open(key, 'JP1', publicKey), {id: 'a1', name: 'Ana', kind: 'friend'});
  const [head, , signature] = key.split('.');
  const forged = [head, Buffer.from('{"id":"a1","name":"Eve","kind":"founder"}').toString('base64url'), signature].join('.');
  const other = raw(crypto.generateKeyPairSync('ed25519'));
  for (const [bad, pub] of [[forged, publicKey], [key, other], ['JP1.abc', publicKey], ['', publicKey], [null, publicKey]]) assert.equal(open(bad, 'JP1', pub), null);
  assert.equal(open(key, 'JP1R', publicKey), null);
});

test('a key is checked for kind, end date and withdrawal, with words the user can act on', () => {
  const good = sign({id: 'a1', name: 'Ana', kind: 'founder', until: '2026-12-31'});
  assert.deepEqual(check(good, {now: NOW, publicKey}).license, {id: 'a1', name: 'Ana', kind: 'founder', until: '2026-12-31'});
  assert.match(check(good, {now: NOW, publicKey, revoked: ['a1']}).error, /withdrawn/);
  assert.match(check(sign({id: 'a2', name: 'Bo', kind: 'pass', until: '2026-10-14'}), {now: NOW, publicKey}).error, /ended on 2026-10-14/);
  assert.match(check(sign({id: 'a3', name: 'Cy', kind: 'boss'}), {now: NOW, publicKey}).error, /isn't a Job Pilotto license key/);
  assert.match(check('hello', {now: NOW, publicKey}).error, /JP1/);
});

test('free for 30 applications OR 60 days, whichever lasts longer', () => {
  const at = (applied, ago) => allowance({applied, firstRunAt: days(ago), now: NOW, publicKey});
  assert.equal(at(12, 19).ended, false);
  assert.equal(at(12, 19).daysLeft, 41);
  assert.equal(at(30, 10).ended, false, '30 used but still in the first 60 days');
  assert.equal(at(5, 90).ended, false, '60 days passed but fewer than 30 applications');
  assert.equal(at(30, 60).ended, true);
  assert.equal(at(45, 200).ended, true);
});

test('a valid key lifts the limit; a bad one leaves it and says why', () => {
  const key = sign({id: 'a1', name: 'Ana', kind: 'friend'});
  const licensed = allowance({applied: 99, firstRunAt: days(300), key, now: NOW, publicKey});
  assert.deepEqual([licensed.licensed, licensed.ended, licensed.license.name], [true, false, 'Ana']);
  const bad = allowance({applied: 99, firstRunAt: days(300), key: 'JP1.x.y', now: NOW, publicKey});
  assert.deepEqual([bad.licensed, bad.ended], [false, true]);
  assert.ok(bad.keyProblem);
});

test('the words: counters while free, the end, and who holds the key', () => {
  assert.equal(text({licensed: false, ended: false, used: 12, limit: 30, daysLeft: 41}), '12 of 30 free applications · 41 days left');
  assert.equal(text({licensed: false, ended: false, used: 12, limit: 30, daysLeft: 1}), '12 of 30 free applications · 1 day left');
  assert.match(text({licensed: false, ended: true, used: 31, limit: 30, daysLeft: 0}), /free period over/);
  assert.equal(text({licensed: true, license: {name: 'Ana', kind: 'founder', until: null}}), 'Licensed to Ana · founder key');
});

test('revocation lists are signed like keys', () => {
  assert.deepEqual(revocations(sign({revoked: ['a1', 'b2'], issued: '2026-10-01'}, 'JP1R'), publicKey), ['a1', 'b2']);
  assert.equal(revocations(sign({revoked: ['a1']}, 'JP1'), publicKey), null);
});

const fakeStorage = (settings = {}) => ({settings: () => settings, saveSettings: patch => Object.assign(settings, patch)});

test('the app stores its first run once, keeps the most applications it ever saw, and blocks only when over', () => {
  let applied = 3, clock = NOW;
  const storage = fakeStorage();
  const license = create(storage, {appliedNow: () => applied, now: () => clock});
  assert.equal(license.state().used, 3);
  const first = storage.settings().firstRunAt;
  applied = 0;  // an empty or slow read never lowers it
  clock += 70 * DAY;
  assert.equal(license.state().used, 3);
  assert.equal(storage.settings().firstRunAt, first);
  assert.equal(license.blocked(), null);
  applied = FREE_APPLICATIONS;
  assert.equal(license.blocked().ended, true);
  assert.equal(license.set('nonsense').ok, false);
  assert.equal(license.blocked().ended, true);
});

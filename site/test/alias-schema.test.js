// The alias format: what a label meaning may be, and how a question's wording is matched to it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {KEYS, SENSITIVE, aliasKey, cleanLabel, validateAlias, validateBundle} from '../../extension/alias-schema.js';

test('an alias points one phrase at one profile field; anything else is refused', () => {
  assert.deepEqual(validateAlias({key: 'place_of_origin', phrase: 'Place of Heimat *'}), {ok: true, alias: {key: 'place_of_origin', phrase: 'place of heimat'}});
  for (const bad of [null, {key: 'salary', phrase: 'expected pay'}, {key: 'email', phrase: ''}, {key: 'email', phrase: 'x'.repeat(61)}, {key: 'email', phrase: 'mail 2026'},
    {key: 'email', phrase: 'I agree to the terms'}, {key: 'full_name', phrase: 'your signature'}, {key: 'email', phrase: 'a<b>c'}, {key: 'email', phrase: 'visa status'}, {key: 'phone', phrase: 'gender'}]) {
    assert.equal(validateAlias(bad).ok, false, JSON.stringify(bad));
  }
  assert.ok(SENSITIVE.every(key => KEYS.includes(key)));
});

test('a bundle keeps valid aliases once each and their rollout', () => {
  const bundle = validateBundle([{key: 'email', phrase: 'Courriel', rollout: 25}, {key: 'email', phrase: 'courriel'}, {key: 'bad', phrase: 'x y z'}, null]);
  assert.deepEqual(bundle, [{key: 'email', phrase: 'courriel', rollout: 25}]);
});

test('the wording matches the whole phrase or stands on word boundaries, first alias wins', () => {
  const aliases = [{key: 'place_of_origin', phrase: 'heimatort'}, {key: 'email', phrase: 'courriel'}, {key: 'location', phrase: 'ville de résidence'}];
  assert.equal(aliasKey('Heimatort *', aliases), 'place_of_origin');
  assert.equal(aliasKey('Votre courriel professionnel', aliases), 'email');
  assert.equal(aliasKey('Ville de résidence', aliases), 'location');
  assert.equal(aliasKey('Heimatorte', aliases), '');      // not on a word boundary
  assert.equal(aliasKey('Something else', aliases), '');
  assert.equal(aliasKey('', aliases), '');
  assert.equal(aliasKey('Heimatort', undefined), '');
  assert.equal(cleanLabel('Mail me at jane@example.com'), '');
});

// The learning floor NOW (owner, 9 Oct 2026: "1 install, public form text only"): what one install reports is learned. The later floors are
// covered by the knowledge, aliases and meanings tests (useLaterFloors).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installsNeeded} from '../src/learning-floor.js';

test('now: one install is enough for every kind of learning', () => {
  for (const kind of ['question', 'alias', 'aliasSensitive', 'meaning']) assert.equal(installsNeeded(kind), 1, kind);
});

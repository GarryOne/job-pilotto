// The site stores the moves the app counts (site/src/ladder-moves.js <- desktop/lib/ladder/learning.js counts()): the site cannot import the app's rungs (they read the disk and the shared
// folder), so it keeps its own copy of the fixed lists. This keeps the copies equal: a kind, an outcome or a shape the app counts is never dropped by the site, and nothing more is accepted.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SHAPE} from '../lib/ladder/learning.js';
import {KINDS} from '../lib/ladder/rung2-sketch.js';
import {OUTCOMES} from '../lib/ladder/rung3-digest.js';
import * as site from '../../site/src/ladder-moves.js';

test('the site\'s fixed lists for ladder moves are the app\'s', () => {
  assert.deepEqual(site.KINDS, KINDS);
  assert.deepEqual(site.OUTCOMES, OUTCOMES);
  assert.equal(site.SHAPE.source, SHAPE.source);
});

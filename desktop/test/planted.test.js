// The Sentry reporter of the end-to-end journey drops what a planted failure caused, and a user's install never does.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {plantedRecently, PLANT_WINDOW_MS} from '../lib/planted.js';

const E2E = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_PLANTED_FILE: '/x'};
test('a plant within the window hides the report; an older one, a missing file and a user install do not', () => {
  const read = text => () => text;
  assert.equal(plantedRecently(E2E, 100_000, read('1 older\n99000 ai hang\n')), true);
  assert.equal(plantedRecently(E2E, 99_000 + PLANT_WINDOW_MS + 1, read('99000 ai hang\n')), false);
  assert.equal(plantedRecently(E2E, 100_000, () => { throw new Error('ENOENT'); }), false);
  assert.equal(plantedRecently(E2E, 100_000, read('')), false);
  assert.equal(plantedRecently({JOB_PILOTTO_E2E_PLANTED_FILE: '/x'}, 100_000, read('99000 x\n')), false, 'only the journey');
  assert.equal(plantedRecently({}, 100_000, read('99000 x\n')), false, 'a user install has no planted file');
});

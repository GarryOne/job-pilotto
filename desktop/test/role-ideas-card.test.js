// "Roles that fit you" (src/ai/role_ideas.py): the Profile's roles as chips, the ones set aside never shown.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ideasCard} from '../renderer/coverage-card.js';

test('ideas become chips with their counts; set-aside roles and an empty answer show nothing', () => {
  const card = ideasCard([{role: 'Cashier', word: 'caissier', why: 'shop', count: 6}, {role: 'Retoucher', word: 'retouche', why: 'Photoshop', count: 0}], ['retouche']);
  assert.deepEqual(card.chips.map(chip => [chip.term, chip.label]), [['caissier', '+ Cashier · 6']]);
  assert.match(card.chips[0].title, /^shop\. Searched as "caissier"; 6 open jobs/);
  assert.equal(ideasCard([], []), null);
  assert.equal(ideasCard([{role: 'R', word: 'retouche', count: 1}], ['retouche']), null);
});

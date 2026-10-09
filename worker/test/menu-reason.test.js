// A menu left empty carries the reason the pick OBSERVED (extension/menu-reason.js), never the fixed "needs a real click" label
// (9 Oct 2026: the digest ranked real_click first, while on Migros the menu opened and the option was found, but a scripted click did not select).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_REASONS, OLD_MENU_REASON, menuCause, menuReason } from '../../extension/menu-reason.js';
import { CAUSES, causeOf, cleanCard, fillCard } from '../../extension/fill-card.js';

test('each observation of the pick gives its own reason', () => {
  const cases = [
    [{ opened: false, found: null, selectedAfter: null }, 'menu_not_opened'],
    [{ opened: true, found: false, selectedAfter: null }, 'no_option'],
    [{ opened: true, found: true, selectedAfter: false }, 'menu_not_selected'],
    [{ opened: true, found: true, selectedAfter: true }, 'menu_not_read'],
    [{ opened: null, found: null, selectedAfter: null }, 'no_option'],   // nothing observed: as before this change
  ];
  for (const [combo, cause] of cases) assert.equal(menuCause(`${menuReason(combo)} (2.1 s)`), cause, JSON.stringify(combo));
  assert.equal(menuCause('dropdown not clicked: "Fill drop-down menus too" is off'), 'menu_not_clicked');
  assert.equal(menuCause(OLD_MENU_REASON), 'real_click');
  assert.equal(menuCause('answer given, but the field did not take it'), '');
});

// The class: every menu reason is a cause the fill card counts and the site keeps (a new one without them fails here).
test('every menu reason is counted by the fill card and kept by the site', () => {
  for (const { text, cause } of MENU_REASONS) {
    assert.ok(CAUSES.includes(cause), cause);
    assert.equal(causeOf({ field: 'f', reason: `${text} (1.0 s)` }), cause);
  }
  const card = fillCard({ id: 'fill-0002-abc', trace: MENU_REASONS.map(({ text }, i) => ({ label: `M${i}`, field: `m${i}`, type: 'combobox', required: true, outcome: 'left', reason: `${text} (1.0 s)` })) });
  assert.deepEqual(Object.keys(cleanCard(card).causes).sort(), MENU_REASONS.map(item => item.cause).sort());
});

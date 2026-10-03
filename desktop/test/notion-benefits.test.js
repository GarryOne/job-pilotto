// The connect prompt's words: six advantages, every key one the app knows.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ICON_NAMES} from '../renderer/icons.js';
import * as benefits from '../renderer/notion-benefits.js';
import * as gate from '../lib/notion-gate.js';

test('six advantages, each with a known icon, a bold lead and a sentence', () => {
  assert.equal(benefits.NOTION_BENEFITS.length, 6);
  for (const item of benefits.NOTION_BENEFITS) {
    assert.ok(ICON_NAMES.includes(item.icon), item.icon);
    assert.ok(item.lead.length > 3 && item.text.length > 10);
  }
});

test('the why choices and the locked pages use keys the app validates', () => {
  assert.deepEqual(benefits.WHY_CHOICES.map(([key]) => key).sort(), [...gate.WHY].sort());
  for (const reason of Object.values(benefits.LOCKED_VIEWS)) assert.ok(gate.REASONS[reason], reason);
});

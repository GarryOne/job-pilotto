// Outbound or inbound: the window's rule gives the same answers as the Python one (one shared table).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {isInbound, origin} from '../renderer/origin.js';

const TABLE = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/opportunity_origin.json', import.meta.url), 'utf8'));

test('every case of the shared table (tests/fixtures/opportunity_origin.json)', () => {
  assert.ok(TABLE.cases.length >= 10);
  for (const {name, row, origin: expected} of TABLE.cases) assert.equal(origin(row), expected, name);
});

test('a job without any of the fields is outbound', () => {
  assert.equal(origin(), 'outbound');
  assert.equal(isInbound(null), false);
  assert.equal(isInbound({source: 'Phone'}), true);
});

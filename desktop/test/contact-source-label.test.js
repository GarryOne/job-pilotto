// The contact's source label reaches the extension (extension/flow.js debug.details.source) and from there the "improve the filler" review ask: it must carry NO clock time, or no memo can ever match that ask
// (12 Oct 2026: "kept from Notion (16:17)"). Guard: the label is fixed words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {keptSource} from '../lib/server-contact.js';

test('the kept contact\'s source label is fixed words: no clock time, whatever the time of the kept copy', () => {
  assert.equal(keptSource('2026-10-11T16:17:42.000Z'), 'kept copy on this Mac');
  assert.equal(keptSource('2026-10-11T23:59:59.000Z'), 'kept copy on this Mac');
  const source = fs.readFileSync(new URL('../lib/server-contact.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /kept (from \w+|copy[^']*) \(\$\{/, 'no time in a label');
});

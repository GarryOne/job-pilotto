// The app side of the usage-weighted pool's host check (lib/host-clean.js): the same cases as the site's (site/test/host-cases.json), so the two ends agree.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {cleanHost} from '../lib/host-clean.js';

const cases = JSON.parse(readFileSync(new URL('../../site/test/host-cases.json', import.meta.url), 'utf8'));

test('a host is kept only as a plain host name', () => {
  for (const [input, output] of cases.good) assert.equal(cleanHost(input), output, input);
  for (const input of cases.bad) assert.equal(cleanHost(input), null, JSON.stringify(input));
});

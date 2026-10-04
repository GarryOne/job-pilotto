// A digest card with no items says so in words and offers "Open Jobs", not an empty "Top matches" with a bare link.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('digest card explains an empty Top matches', () => {
  const source = fs.readFileSync(path.join(here, '../renderer/pages/activity.js'), 'utf8');
  assert.match(source, /nothing new to show/);
  assert.match(source, /Open Jobs →/);
});

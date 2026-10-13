// No suite reads applications under the Jobs menu's "All matches": it leaves applied jobs out (76d1cdd), only "Everything" lists them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['lib', 'suites'].flatMap(dir => fs.readdirSync(path.join(HERE, '..', dir)).filter(name => name.endsWith('.mjs')).map(name => path.join(HERE, '..', dir, name)));

test('no e2e file picks the Jobs menu value "all" (it hides applied jobs)', () => {
  const picks = FILES.filter(file => /filter-status['"`]?\s*,\s*['"]all['"]|getElementById\('filter-status'\)[^;]*\.value\s*=\s*'all'/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(picks.map(file => path.basename(file)), []);
});

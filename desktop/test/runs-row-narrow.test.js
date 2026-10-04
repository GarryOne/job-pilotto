// The narrow window must keep each Recent runs row's time and result (it once hid every child after the pill).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

test('narrow Recent runs rows still show when and result', () => {
  const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer/style.css'), 'utf8');
  const narrow = css.split('\n').find(line => line.includes('@media (max-width: 1180px)') && line.includes('.runs-row'));
  assert.ok(narrow, 'narrow rule for .runs-row exists');
  assert.ok(!/nth-child\(n\+4\)/.test(narrow), 'time and result are not hidden');
  assert.match(narrow, /\.runs-row > :nth-child\(5\)/);
});

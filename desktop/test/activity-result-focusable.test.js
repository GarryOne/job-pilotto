// The activity result box scrolls (max-height + overflow), so it must be keyboard-focusable (axe scrollable-region-focusable).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('activity-result is a focusable, labelled region', () => {
  const html = fs.readFileSync(path.join(here, '../renderer/index.html'), 'utf8');
  const tag = html.match(/<div[^>]*id="activity-result"[^>]*>/)[0];
  assert.match(tag, /tabindex="0"/);
  assert.match(tag, /role="region"/);
  assert.match(tag, /aria-label="/);
});

// The panel never swallows the page's clicks (owner, 9 Oct 2026): its host and .jp box take no pointer events, only the card and the pill do.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('the panel host and its box let clicks through; only the card and the pill take them', () => {
  const source = fs.readFileSync(new URL('../../extension/review.js', import.meta.url), 'utf8');
  assert.match(source, /host\.style\.cssText = '[^']*pointer-events:none/);
  assert.match(source, /\.jp \{[^}]*pointer-events: none;[^}]*\} \.jp > \* \{ pointer-events: auto; \}/s);
});

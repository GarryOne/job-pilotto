// The extension's own pages (popup, options, allow) style elements with a display of their own, which beats the browser's
// [hidden] { display: none }: on 8 Oct 2026 the popup's "Read the jobs" buttons showed on every tab, an Apply tab included, though the
// script hid them. Every page with a stylesheet keeps the [hidden] rule.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readdirSync, readFileSync} from 'node:fs';

const dir = new URL('../../extension/', import.meta.url);

test('every extension page with a stylesheet makes hidden win over its own display rules', () => {
  const pages = readdirSync(dir).filter(name => name.endsWith('.html'));
  assert.ok(pages.includes('popup.html'));
  for (const page of pages) {
    const html = readFileSync(new URL(page, dir), 'utf8');
    if (!html.includes('<style>')) continue;
    assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important/, page);
  }
});

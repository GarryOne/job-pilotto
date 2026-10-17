// Settings pages: every card takes the full content width, one per row (owner, 17 Oct 2026: the Plan cards sat at ~340 px each with the rest of the page empty).
// No CSS rule may turn a settings page into a grid or cap its cards' width; the siblings (every settings page) are checked in one loop.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));
const css = readdirSync(renderer).filter(f => f.endsWith('.css')).map(f => ({f, text: readFileSync(renderer + f, 'utf8')}));
const pages = [...readFileSync(renderer + 'index.html', 'utf8').matchAll(/class="settings-page"[^>]*data-settings-page="([\w-]+)"/g)].map(m => m[1]);

test('there are settings pages to check', () => assert.ok(pages.length >= 8, pages.join()));

for (const page of pages) {
  test(`Settings → ${page}: its cards are not laid out in a grid or capped in width`, () => {
    for (const {f, text} of css) {
      for (const rule of text.split('}')) {
        const [selector, body = ''] = rule.split('{');
        if (!selector.includes(`data-settings-page="${page}"]`)) continue;
        assert.doesNotMatch(body, /grid-template-columns|display:\s*(grid|flex)|max-width/, `${f}: ${selector.trim()}`);
      }
    }
  });
}

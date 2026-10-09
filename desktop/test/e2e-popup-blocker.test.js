// Every e2e browser keeps Chrome's pop-up blocker on, as a person's Chrome has it. Playwright turns it off by default
// (--disable-popup-blocking), and with it off a posting whose Apply opens its form by window.open passed in e2e for weeks while
// a real Chrome refused it: the extension's click is not the person's (jobs.ch, 9 Oct 2026). Fails when a launcher drops it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const e2e = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e');
const sources = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry =>
  entry.isDirectory() ? (['node_modules', 'test-results', 'report'].includes(entry.name) ? [] : sources(path.join(dir, entry.name)))
    : /\.m?js$/.test(entry.name) ? [path.join(dir, entry.name)] : []);

test('every e2e browser that loads the extension keeps the pop-up blocker on', () => {
  const launches = [];
  for (const file of sources(e2e)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/chromium\.(launchPersistentContext|launch)\(/g)) {
      const call = text.slice(match.index, match.index + 600);
      if (!call.includes('load-extension')) continue;   // a page-only browser (no extension): its pop-ups are the page's own
      launches.push({file: path.relative(e2e, file), blocked: /ignoreDefaultArgs:\s*\[[^\]]*'--disable-popup-blocking'/.test(call)});
    }
  }
  assert.ok(launches.length >= 3, `found the e2e launchers that load the extension (${launches.length})`);
  assert.deepEqual(launches.filter(launch => !launch.blocked).map(launch => launch.file), []);
});

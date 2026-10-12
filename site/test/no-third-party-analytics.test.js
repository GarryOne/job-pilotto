// The website sends nothing to a third-party analytics service (owner, 13 Oct 2026): its own counting (src/stats.js) is the only one. The privacy page may name PostHog for the app.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

test('no page or script of the website mentions or calls a third-party analytics service', () => {
  const dir = new URL('../public/', import.meta.url);
  const files = readdirSync(dir).filter(name => /\.(html|js)$/.test(name) && name !== 'privacy.html');
  assert.ok(files.includes('track.js'));
  for (const name of files) assert.doesNotMatch(readFileSync(new URL(name, dir), 'utf8'), /posthog|google-analytics|googletagmanager|hotjar|plausible/i, name);
});

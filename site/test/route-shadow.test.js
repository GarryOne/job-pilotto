// No Worker route may share its path with a file in public/: Workers static assets answer first, so the route's code never runs (18 Oct 2026: /changelog.json showed 0.7.16 only).
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const routes = [...new Set([...source.matchAll(/pathname === '(\/[^']*)'/g)].map(match => match[1]))].filter(path => path !== '/');
const isFile = path => ['', '.html'].some(ext => existsSync(new URL(`../public${path}${ext}`, import.meta.url)));

test('every exact route in src/index.js is free of a same-named file in public/ (the file would shadow it)', () => {
  assert.ok(routes.length > 10, `routes found: ${routes.length}`);
  assert.deepEqual(routes.filter(isFile), []);
});

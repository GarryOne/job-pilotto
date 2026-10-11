// The recorded-pages CI job must install the app's own packages: a row case starts the offline app (desktop/lib/server.js), which imports them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {builtinModules} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/recorded-pages.yml'), 'utf8');

test('the recorded-pages workflow installs desktop/ packages, and the offline app\'s bare imports are all among them', () => {
  assert.match(workflow, /working-directory: desktop\n\s+run: npm (ci|install)\b/, 'a step installs desktop/ packages (the 34 old cases never started the app; the first row case did and died with ERR_MODULE_NOT_FOUND on 11 Oct 2026)');
  const deps = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'desktop/package.json'), 'utf8')).dependencies);
  const lib = path.join(root, 'desktop/lib');
  const bare = new Set();
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).forEach(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(file);
    if (!/\.(js|mjs)$/.test(entry.name)) return;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/(?:from|import\(|require\()\s*['"](@[^/'"]+\/[^'"/]+|[a-z][\w.-]*)(?:\/[^'"]*)?['"]/g)) bare.add(match[1]);
  });
  walk(lib);
  const builtin = new Set(['electron', ...builtinModules]);
  const missing = [...bare].filter(name => !builtin.has(name) && !name.startsWith('node:') && !deps.includes(name));
  assert.deepEqual(missing, [], 'a package desktop/lib imports that is not in desktop/package.json dependencies (the CI job installs only those)');
});

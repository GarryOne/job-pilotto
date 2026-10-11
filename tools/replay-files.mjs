// The files a recorded replay loads, found by structure (owner, 12 Oct 2026): the extension's files reached from its manifest (service worker, content scripts,
// pages) through imports and the file lists it names (PAGE_FILES), and the app modules the offline app runs (desktop/lib reached from desktop/e2e/lib/offline-app-child.mjs).
// tools/recorded-cases.mjs asks a recorded page for a change to any of them. No hand list: a new file is covered once something imports it. Guard: desktop/test/recorded-cases.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every quoted string in a source that names a code file; the caller resolves it.
const quoted = text => [...text.matchAll(/['"`]([\w@./-]+\.(?:m?js|json))['"`]/g)].map(found => found[1]);

// -> Set of repo-relative files reached from `roots` (repo-relative). resolve(spec, fromFile) -> candidate repo-relative paths.
function closure(root, roots, resolve, keep) {
  const seen = new Set(), todo = [...roots];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file) || !fs.existsSync(path.join(root, file)) || !fs.statSync(path.join(root, file)).isFile()) continue;
    seen.add(file);
    if (!/\.m?js$/.test(file)) continue;
    for (const spec of quoted(fs.readFileSync(path.join(root, file), 'utf8'))) for (const next of resolve(spec, file)) if (keep(next) && !seen.has(next)) todo.push(next);
  }
  return seen;
}

export function manifestFiles(manifest) {
  const scripts = [manifest.background?.service_worker, ...(manifest.content_scripts || []).flatMap(one => one.js || [])];
  const pages = [manifest.action?.default_popup, manifest.options_page, manifest.options_ui?.page].filter(Boolean);
  return [...scripts, ...pages].filter(Boolean);
}

export function replayFiles(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  const inExtension = spec => (spec.startsWith('.') ? null : `extension/${spec}`);
  const extension = closure(root, manifestFiles(manifest).filter(file => /\.m?js$/.test(file)).map(file => `extension/${file}`), (spec, from) => [
    inExtension(spec), path.posix.join(path.posix.dirname(from), spec)].filter(Boolean), file => file.startsWith('extension/') && !/manifest\.json$|fingerprint\.json$/.test(file));
  const app = closure(root, ['desktop/e2e/lib/offline-app-child.mjs'], (spec, from) => (spec.startsWith('.') ? [path.posix.join(path.posix.dirname(from), spec)] : []), file => file.startsWith('desktop/lib/') || file === 'desktop/e2e/lib/offline-app-child.mjs');
  app.delete('desktop/e2e/lib/offline-app-child.mjs');
  return new Set([...extension, ...app]);
}

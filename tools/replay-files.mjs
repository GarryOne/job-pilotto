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

// The harness files a runner reaches from `entry` (desktop/e2e/...): what it imports and the scripts it starts by path, found the same way.
export function harnessFiles(entry, root = ROOT) {
  // A bare name is tried beside the file too (offline-app.mjs starts path.join(here, 'offline-app-child.mjs')), and as a repo path.
  return closure(root, [entry], (spec, from) => [path.posix.join(path.posix.dirname(from), spec), ...(spec.startsWith('.') ? [] : [spec])], file => file.startsWith('desktop/'));
}

// FLOW_FILES as written in desktop/e2e/flows.mjs (read, not imported: this file stays synchronous): every quoted repo path of the list.
const flowFiles = root => { const text = fs.readFileSync(path.join(root, 'desktop/e2e/flows.mjs'), 'utf8'); const list = /export const FLOW_FILES\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] || ''; return [...list.matchAll(/'((?:extension|desktop)\/[^']+)'/g)].map(found => found[1]); };

// What each replay job of a pull request loads (tools/affected-jobs.py asks, a folder ends with /): the whole extension (its manifest and data files load too),
// the app modules above, the job's pages and its runner's files. A change to none of them cannot change what the job replays.
export function jobFiles(job, root = ROOT) {
  const loaded = ['extension/', ...replayFiles(root)];
  if (job === 'replays') return new Set([...loaded, 'desktop/e2e/recorded/', ...harnessFiles('desktop/e2e/test/recorded-pages.test.mjs', root)]);
  if (job === 'zoo') return new Set([...loaded, 'desktop/e2e/widget-zoo/', ...harnessFiles('desktop/e2e/widget-zoo.mjs', root)]);
  // The flow e2e and the live canary on a pull request (.github/workflows/e2e-flow.yml, flow-canary.yml), only where it is really relevant (owner, 13 Oct 2026): the
  // extension, the flow files the app runs for an application (desktop/e2e/flows.mjs FLOW_FILES), the two suites' own files and the fixtures they read. Not the app's
  // other modules: main's scheduled e2e is the backstop for them.
  if (job === 'e2e-flow') return new Set(['extension/', ...flowFiles(root), 'desktop/e2e/fixtures/real-forms/', 'desktop/e2e/fixtures/cv.pdf', ...['apply', 'applycv'].flatMap(suite => [...harnessFiles(`desktop/e2e/suites/${suite}.mjs`, root)])]);
  throw new Error(`no replay job ${job}: replays, zoo or e2e-flow`);
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === '--job') console.log([...jobFiles(process.argv[3])].sort().join('\n'));

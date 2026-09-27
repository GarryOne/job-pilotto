// Build staging.
//   node scripts/stage.mjs          copy worker/src into shared/worker (the app imports it; also run by
//                                   npm start and npm test, so dev and packaged use the same files)
//   node scripts/stage.mjs --app    also stage build/pilot: what a packaged app runs (the Python
//                                   pipeline, config, tools, docs, the Chrome extension, requirements)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '..');
const copy = (from, to) => fs.cpSync(path.join(repo, from), to, {recursive: true, filter: src => !/__pycache__|node_modules|\.DS_Store/.test(src)});

fs.rmSync(path.join(desktop, 'shared'), {recursive: true, force: true});
copy('worker/src', path.join(desktop, 'shared', 'worker'));

if (process.argv.includes('--app')) {
  const pilot = path.join(desktop, 'build', 'pilot');
  const python = path.join(pilot, 'python');
  const keepPython = fs.existsSync(python) ? fs.mkdtempSync(path.join(desktop, 'build', 'py-')) : null;
  if (keepPython) fs.renameSync(python, path.join(keepPython, 'python')); // the Python runtime is staged separately (CI)
  fs.rmSync(pilot, {recursive: true, force: true});
  fs.mkdirSync(pilot, {recursive: true});
  for (const item of ['src', 'config', 'tools', 'extension', 'templates', 'requirements.txt', 'requirements-transcribe.txt']) copy(item, path.join(pilot, item));
  for (const doc of ['notion-profile-template.md', 'job-pilotto-guide.md']) copy(`docs/${doc}`, path.join(pilot, 'docs', doc));
  if (keepPython) { fs.renameSync(path.join(keepPython, 'python'), python); fs.rmSync(keepPython, {recursive: true}); }
  console.log(`Staged ${pilot}`);
  // Which build this is, for the About box and the sidebar: CI's run number (the release's build N) and commit.
  let commit = (process.env.GITHUB_SHA || '').slice(0, 7);
  try { commit ||= execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {cwd: repo}).toString().trim(); } catch {}
  const info = {build: process.env.GITHUB_RUN_NUMBER || 'local', commit, date: new Date().toISOString().slice(0, 10)};
  fs.writeFileSync(path.join(desktop, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
  console.log(`Build info: build ${info.build}, ${info.commit}`);
}
console.log('Staged shared/worker');

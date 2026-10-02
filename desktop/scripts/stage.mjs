// Build staging.
//   node scripts/stage.mjs          copy worker/src into shared/worker and the recipe format into shared/ (the app imports them; also run by
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
// The recipe format, one source for the site, the extension and the app (extension/recipe-schema.js).
fs.copyFileSync(path.join(repo, 'extension', 'recipe-schema.js'), path.join(desktop, 'shared', 'recipe-schema.js'));
// The Telegram bot as ONE file (its Anthropic dependency inside), which the app uploads to the user's own
// Cloudflare account for "Telegram buttons, always on" (lib/telegram-cloud.js).
await (await import('esbuild')).build({entryPoints: [path.join(repo, 'worker', 'src', 'index.js')], bundle: true,
  format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'], target: 'es2022', minify: true,
  nodePaths: [path.join(desktop, 'node_modules')], outfile: path.join(desktop, 'shared', 'bot-worker.js'), logLevel: 'warning'});

if (process.argv.includes('--app')) {
  const pilot = path.join(desktop, 'build', 'pilot');
  const python = path.join(pilot, 'python');
  const keepPython = fs.existsSync(python) ? fs.mkdtempSync(path.join(desktop, 'build', 'py-')) : null;
  if (keepPython) fs.renameSync(python, path.join(keepPython, 'python')); // the Python runtime is staged separately (CI)
  fs.rmSync(pilot, {recursive: true, force: true});
  fs.mkdirSync(pilot, {recursive: true});
  for (const item of ['src', 'config', 'tools', 'extension', 'templates', 'requirements.txt', 'requirements-transcribe.txt']) copy(item, path.join(pilot, item));
  for (const doc of ['notion-profile-template.md', 'job-pilotto-guide.md']) copy(`docs/${doc}`, path.join(pilot, 'docs', doc));
  // The skill Apply with Claude sessions follow: they start in this folder, where Claude Code finds .claude/skills.
  copy('.claude/skills/apply-to-job', path.join(pilot, '.claude', 'skills', 'apply-to-job'));
  if (keepPython) { fs.renameSync(path.join(keepPython, 'python'), python); fs.rmSync(keepPython, {recursive: true}); }
  // AudioTee (scripts/audiotee.sh): the call's audio recorder, at pilot/bin/audiotee in the app.
  const audiotee = path.join(desktop, 'build', 'bin', 'audiotee');
  if (fs.existsSync(audiotee)) {
    fs.mkdirSync(path.join(pilot, 'bin'), {recursive: true});
    fs.copyFileSync(audiotee, path.join(pilot, 'bin', 'audiotee'));
    fs.chmodSync(path.join(pilot, 'bin', 'audiotee'), 0o755);
    const license = `${audiotee}.LICENSE`;
    if (fs.existsSync(license)) fs.copyFileSync(license, path.join(pilot, 'bin', 'audiotee.LICENSE'));
  } else console.log('AudioTee not built (scripts/audiotee.sh): the app records the call through screen capture');
  console.log(`Staged ${pilot}`);
  // Which build this is, for the About box and the sidebar: CI's run number (the release's build N) and commit.
  let commit = (process.env.GITHUB_SHA || '').slice(0, 7);
  try { commit ||= execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {cwd: repo}).toString().trim(); } catch {}
  const info = {build: process.env.GITHUB_RUN_NUMBER || 'local', commit, date: new Date().toISOString().slice(0, 10)};
  fs.writeFileSync(path.join(desktop, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
  console.log(`Build info: build ${info.build}, ${info.commit}`);
}
console.log('Staged shared/worker');

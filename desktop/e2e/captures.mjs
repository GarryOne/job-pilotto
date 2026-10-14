// npm run captures -- pull [--days N] | list: the captures library on this Mac (lib/capture-library.mjs). pull: each CI pool run's pool-captures-<run> artifact (record-sites.yml,
// pool-proof.yml; 30 days on GitHub) copied into <QA folder>/captures/<day>/<row>/, once per run (pulled.json); list: rows x days x build. Reads GitHub only, never a site.
// Spec docs/superpowers/specs/2026-10-13-capture-once-measure-many.md. Guard: e2e/test/captures.test.mjs (mergePulled).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {capturesRoot, mergePulled, pruneCaptures} from './lib/capture-library.mjs';

const [verb = 'list', ...rest] = process.argv.slice(2), flag = name => { const at = rest.indexOf(`--${name}`); return at >= 0 ? rest[at + 1] : ''; };
const root = path.resolve(flag('root') || capturesRoot());
const gh = (...cmd) => execFileSync('gh', cmd, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

if (verb === 'pull') {
  const days = Number(flag('days')) || 7, since = new Date(Date.now() - days * 86400000).toISOString();
  const pulledFile = path.join(root, 'pulled.json'), pulled = new Set((() => { try { return JSON.parse(fs.readFileSync(pulledFile, 'utf8')); } catch { return []; } })());
  const ids = new Set();
  for (const workflow of ['record-sites.yml', 'pool-smoke.yml', 'pool-proof.yml']) {
    try { for (const run of JSON.parse(gh('run', 'list', '--workflow', workflow, '--limit', '60', '--json', 'databaseId,createdAt'))) if (run.createdAt >= since) ids.add(String(run.databaseId)); } catch (error) { console.log(`captures: ${workflow}: ${String(error.stderr || error.message).trim().slice(0, 160)}`); }
  }
  let added = 0;
  for (const id of [...ids].filter(one => !pulled.has(one)).sort()) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-captures-pull-'));
    try { gh('run', 'download', id, '--name', `pool-captures-${id}`, '--dir', tmp); } catch { fs.rmSync(tmp, {recursive: true, force: true}); continue; }   // a run with no capture (before 13 Oct 2026, or none ran)
    const kept = mergePulled(tmp, root);
    fs.rmSync(tmp, {recursive: true, force: true});
    pulled.add(id); added += kept.length;
    console.log(`captures: run ${id}: ${kept.length} captures${kept.length ? `: ${kept.join(', ')}` : ''}`);
  }
  fs.mkdirSync(root, {recursive: true});
  fs.writeFileSync(pulledFile, `${JSON.stringify([...pulled].sort(), null, 1)}\n`);
  const gone = pruneCaptures(root);
  console.log(`captures: ${added} new captures in ${root}${gone.length ? `; pruned ${gone.join(', ')} (older than 30 days)` : ''}`);
} else if (verb === 'list') {
  let dayNames = [];
  try { dayNames = fs.readdirSync(root).filter(name => /^\d{4}-\d\d-\d\d$/.test(name)).sort(); } catch { /* no library yet */ }
  if (!dayNames.length) console.log(`captures: none in ${root} (npm run captures -- pull, or a live row)`);
  for (const day of dayNames) for (const name of fs.readdirSync(path.join(root, day)).sort()) {
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(root, day, name, 'capture.json'), 'utf8')); } catch { continue; }
    console.log(`${day}  ${String(meta.row || name).slice(0, 60).padEnd(60)}  ${String(meta.build?.commit || '?').slice(0, 9)}  ext ${meta.build?.extension || '?'}  ${meta.result?.reached || '?'}`);
  }
} else { console.error('captures: pull [--days N] | list'); process.exit(2); }

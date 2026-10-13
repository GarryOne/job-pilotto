// The captures library (capture once, measure many: spec docs/superpowers/specs/2026-10-13-capture-once-measure-many.md): EVERY live pool visit, passing or
// failing, keeps its whole journey (lib/replay-candidate.mjs saveCandidate: pages, styles, model answers, presses, AI calls) plus its app log, the build that
// made it and the live result, under <root>/<day>/<row>/, so `npm run measure` can re-run any build on it offline, with no site visit. Mac: <QA folder>/captures
// (outside the repo); CI: SMOKE_CAPTURES, uploaded as the 30-day artifact pool-captures-<run> (owner, 13 Oct 2026). Days older than 30 are pruned (owner).
// Used by smoke.mjs and live.mjs. Guard: e2e/test/capture-library.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extensionVersion} from './applying-report.mjs';
import {saveCandidate, slug} from './replay-candidate.mjs';

export const KEEP_DAYS = 30;
export const capturesRoot = () => process.env.SMOKE_CAPTURES || path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA', 'captures');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The build a capture was made with: the commit (CI's GITHUB_SHA first) and the extension's stamped version.
export function buildStamp(top = repo) {
  let commit = process.env.GITHUB_SHA || '';
  if (!commit) { try { commit = execFileSync('git', ['-C', top, 'rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { /* not a checkout */ } }
  return {commit, extension: extensionVersion()};   // the version this checkout's build stamps (lib/applying-report.mjs)
}

// Removes the day folders (YYYY-MM-DD) older than `days` before `today`. -> the days removed.
export function pruneCaptures(root, {today = new Date().toISOString().slice(0, 10), days = KEEP_DAYS} = {}) {
  const limit = Date.parse(today) - days * 86400000, gone = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch { return gone; }
  for (const name of names.filter(one => /^\d{4}-\d\d-\d\d$/.test(one) && Date.parse(one) < limit)) { fs.rmSync(path.join(root, name), {recursive: true, force: true}); gone.push(name); }
  return gone;
}

// One live visit's capture into the library, whatever its result. -> the folder, or null when the run kept no page.
export function keepCapture({root = capturesRoot(), day, shape, result, output = '', aiCalls = '', captureDir, appLog = '', build = buildStamp(), at = new Date().toISOString()}) {
  // Each visit its own folder (<row>-<hhmmss>): a row visited twice in a day keeps both (saveCandidate empties a folder it writes again).
  const folder = saveCandidate({dir: root, day, shape: `${slug(shape).slice(0, 50)}-${at.slice(11, 19).replace(/:/g, '')}`, result, html: '', output, aiCalls, captureDir, appLog, always: true});
  if (!folder) return null;
  if (appLog) fs.writeFileSync(path.join(folder, 'app.log'), appLog);   // the live side of the positive control: measure parses it as it parses a replay's
  fs.writeFileSync(path.join(folder, 'capture.json'), `${JSON.stringify({row: shape, at, build, result: result || null}, null, 1)}\n`);
  pruneCaptures(root, {today: day});
  return folder;
}

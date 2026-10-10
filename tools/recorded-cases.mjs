#!/usr/bin/env node
// Pre-push check (tools/pre-push-check.sh), owner 10 Oct 2026: "never fix the same website twice". A push that changes how the extension acts on a page
// (extension/page/*, or an extension file of the flow: desktop/e2e/flows.mjs FLOW_FILES) adds or changes a recorded page (desktop/e2e/recorded/, layer 2),
// a journey scenario (desktop/test/journeys.test.js, layer 1) or a field-level fill replay (worker/test/fixtures/fill/), or a commit says why not: "Recorded-unneeded: <why>".
//   node tools/recorded-cases.mjs [--base origin/main]      exit 1 with the reason when the push has neither. Guard: desktop/test/recorded-cases.test.js.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROOF = /^(desktop\/(e2e\/recorded\/|test\/journeys\.test\.js$)|worker\/test\/fixtures\/fill\/)/;   // a recorded page, a scenario, or a field-level fill replay (improve-filling)
export const TRAILER = /^Recorded-unneeded:\s*\S/m;

// -> '' when fine, else the message. changed: the push's files; messages: its commit messages; flowFiles: FLOW_FILES.
export function missingCase(changed, messages, flowFiles) {
  const flows = new Set(flowFiles);
  const acting = changed.filter(file => file.startsWith('extension/') && (file.startsWith('extension/page/') || flows.has(file)));
  if (!acting.length || changed.some(file => PROOF.test(file)) || messages.some(message => TRAILER.test(message))) return '';
  return `this push changes how the extension acts on pages (${acting.slice(0, 4).join(', ')}${acting.length > 4 ? ', …' : ''}) without a recorded page or a journey scenario.
Add the case that shows the fix (twin: npm run twin:drive -- capture <tab> <case> <page> <your worktree>/desktop/e2e/recorded; desktop/e2e/recorded/<case>/case.json, seen failing on the old build with REAL_EXTENSION_DIR),
or a scenario in desktop/test/journeys.test.js, or say why none is needed in the commit body: "Recorded-unneeded: <why>" (a log line, a comment, a refactor the gates already cover).`;
}

async function main() {
  const args = process.argv.slice(2), base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 64 << 20});
  let changed, messages;
  try { changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean); messages = git('log', '--format=%B%x00', `${base}..HEAD`).split('\0'); } catch { return 0; }
  const {FLOW_FILES} = await import(path.join(root, 'desktop/e2e/flows.mjs'));
  const why = missingCase(changed, messages, FLOW_FILES);
  if (why) { console.error(why); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());

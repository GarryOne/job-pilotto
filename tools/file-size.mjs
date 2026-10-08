// No source file over 500 lines (owner, 8 Oct 2026): a big file is read in parts, so its far-away shared state and imports get missed,
// and several sessions editing it at once collide. Files already over it are listed in tools/file-size-allowed.json at their size and may
// only shrink, down to 500 and off the list: one concern per file. Run by the push hook and desktop/test/file-size.test.js.
//   node tools/file-size.mjs      exit 1 with each file over its limit, and each listed file that can come off the list
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const LIMIT = 500;
export const SOURCE = /\.(?:js|mjs|cjs|py)$/;
export const SKIP = /^desktop\/shared\/|node_modules\/|\/vendor\/|\.min\.|^site\/public\//;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function sizeProblems(files, linesOf, allowed) {
  const problems = [];
  for (const file of files) {
    if (!SOURCE.test(file) || SKIP.test(file)) continue;
    const lines = linesOf(file), limit = allowed[file] ?? LIMIT;
    if (lines > limit) problems.push(allowed[file] ? `${file}: ${lines} lines, over its ${limit} (it may only shrink: move a part into its own file)`
      : `${file}: ${lines} lines, over ${LIMIT} (split it: one concern per file)`);
  }
  for (const [file, limit] of Object.entries(allowed)) {
    if (!files.includes(file)) problems.push(`${file} is listed in tools/file-size-allowed.json but gone: take it off the list`);
    else if (linesOf(file) <= LIMIT) problems.push(`${file} is ${linesOf(file)} lines now: take it off tools/file-size-allowed.json`);
    else if (linesOf(file) < limit) problems.push(`${file} shrank to ${linesOf(file)} lines: lower its entry in tools/file-size-allowed.json to that`);
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = execFileSync('git', ['-C', root, 'ls-files'], {encoding: 'utf8'}).split('\n').filter(Boolean);
  const allowed = JSON.parse(fs.readFileSync(path.join(root, 'tools/file-size-allowed.json'), 'utf8'));
  const linesOf = file => { try { return fs.readFileSync(path.join(root, file), 'utf8').split('\n').length - 1; } catch { return 0; } };
  const problems = sizeProblems(files, linesOf, allowed);
  if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
}

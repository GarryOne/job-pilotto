// The AI ladder's progress report: reads the checklist at the end of docs/superpowers/specs/2026-10-10-ai-ladder.md ("## Progress", one "### X. title" per item,
// "- [x]" done, "- [ ] " open) and prints one ASCII bar per item plus the whole. Nothing is estimated: a bar is boxes ticked over boxes. Guard: desktop/test/ladder-progress.test.js.
//   node tools/ladder-progress.mjs [--spec <file>]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const SPEC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../docs/superpowers/specs/2026-10-10-ai-ladder.md');
const WIDTH = 20;

// -> [{title, done, total}] for each "### " item of the "## Progress" section.
export function progressOf(markdown) {
  const start = markdown.indexOf('\n## Progress');
  if (start < 0) return [];
  const items = [];
  for (const line of markdown.slice(start + 1).split('\n').slice(1)) {
    if (/^## /.test(line)) break;
    const title = line.match(/^### (.+)/);
    if (title) { items.push({title: title[1].trim(), done: 0, total: 0}); continue; }
    const box = line.match(/^- \[( |x)\] /i);
    if (box && items.length) { items.at(-1).total += 1; if (box[1].toLowerCase() === 'x') items.at(-1).done += 1; }
  }
  return items.filter(item => item.total > 0);
}

export const bar = (done, total, width = WIDTH) => {
  const filled = total ? Math.round((done / total) * width) : 0;
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
};

export function report(items) {
  const lines = items.map(({title, done, total}) => `${bar(done, total)} ${String(Math.round((done / total) * 100)).padStart(3)}%  ${done}/${total}  ${title}`);
  const done = items.reduce((sum, item) => sum + item.done, 0), total = items.reduce((sum, item) => sum + item.total, 0);
  return [...lines, '', `${bar(done, total)} ${String(total ? Math.round((done / total) * 100) : 0).padStart(3)}%  ${done}/${total}  THE LADDER (all items)`].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const at = process.argv.indexOf('--spec');
  const file = at > 0 ? path.resolve(process.argv[at + 1]) : SPEC;
  console.log(report(progressOf(fs.readFileSync(file, 'utf8'))));
  try {
    const log = execFileSync('git', ['log', '--since=12 hours ago', '--format=%h %ar  %s', '-5'], {cwd: path.dirname(file), encoding: 'utf8'}).trim();
    if (log) console.log(`\nlast commits:\n${log}`);
  } catch { /* not in a git checkout */ }
}

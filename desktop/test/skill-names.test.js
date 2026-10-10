// Skill names (owner, 10 Oct 2026: verb + object + where, never generic): each skill folder's `name:` is its folder, and no tracked file still uses a retired name.
// A retired name is added to RETIRED when a skill is renamed; the module `desktop/e2e/lib/triage-issues.mjs` is code, not the skill, and keeps its name.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const RETIRED = [{old: /twin-loop/, now: 'fix-live-applying-in-twin'}, {old: /triage-issues(?!\.mjs)/, now: 'triage-github-open-issues'}];
const tracked = () => execFileSync('git', ['-C', root, 'ls-files'], {encoding: 'utf8'}).split('\n').filter(Boolean);

test('every skill folder holds a SKILL.md whose name: is the folder', () => {
  const dirs = fs.readdirSync(path.join(root, '.claude/skills'), {withFileTypes: true}).filter(item => item.isDirectory()).map(item => item.name);
  assert.ok(dirs.includes('fix-failing-forms') && dirs.includes('fix-live-applying-in-twin') && dirs.includes('triage-github-open-issues'));
  for (const dir of dirs) {
    const text = fs.readFileSync(path.join(root, '.claude/skills', dir, 'SKILL.md'), 'utf8');
    assert.equal(/^name:\s*(\S+)/m.exec(text)?.[1], dir, dir);
  }
});

test('no tracked file still uses a retired skill name', () => {
  const left = [];
  for (const file of tracked()) {
    if (file === 'desktop/test/skill-names.test.js' || /\.(png|jpe?g|gif|ico|zip|woff2?)$/i.test(file)) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    for (const {old, now} of RETIRED) if (old.test(text)) left.push(`${file}: ${old.source} (now ${now})`);
  }
  assert.deepEqual(left, []);
});

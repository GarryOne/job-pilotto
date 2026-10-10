// The ladder's architecture guard: which rung file may import which, and that the rung map (docs/flows/ladder.md) agrees with the code. Pure reading of source text, no dependency.
//
// ALLOWED EDGES (verified against the real imports on 10 Oct 2026; a new edge needs this table updated in the same commit, and a reason in the commit):
//   rung  file                           may import
//   0     extension/tab-pages.js         ./alias-schema.js
//   1     desktop/lib/ladder/rung1-kept.js      node:fs                 (no AI, no page text)
//   2     desktop/lib/ladder/rung2-sketch.js    ../ai/models.js, ../../shared/alias-schema.js, ./rung1-kept.js (kindKey only), ./rung3-digest.js (askDigest only)
//   1-2   desktop/lib/page-kind.js              the facade: re-exports rung1 and rung2, nothing else
//   2     desktop/lib/account-judge.js          ./ladder/rung2-sketch.js (MODEL only)
//   3     desktop/lib/ladder/rung3-digest.js          ./ai/models.js          (neither page-kind nor escalate)
//   3     extension/ladder/rung3-candidates.js   nothing                 (a classic page script)
//   4     desktop/lib/ladder/rung4-picture.js        node:fs, ./account-judge.js (accountSketch, listed), ./site-accounts.js, ./rung1-kept.js (pageShape only)
//   4     extension/ladder/rung4-picture.js          extension plumbing only (flow, log, account-fill, page-picture, account-act, next-step): no decision rung
//   5     desktop/lib/ladder/rung5-takeover.js       nothing                 (no decision module)
//   router extension/ladder/core.js      nothing
//   climb  extension/ladder/climb.js           ladder-core.js only     (the file does not exist yet: pinned for when it does)
// Guards the ladder spec's last box: "no rung reads another's internals" (docs/superpowers/specs/2026-10-10-ai-ladder.md) and the rung map's consistency.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {FLOW_CORE} from '../e2e/flows.mjs';
import {RUNGS} from '../../extension/ladder/core.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');

// The imports of a source text: [{from, names}] with `from` as written; names is the list of imported bindings ('*' for a namespace, [] for a bare import).
export function importsOf(source) {
  const found = [];
  const statement = /(?:^|\n)[ \t]*(import|export)\b([^;'"`]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  for (let match = statement.exec(source); match; match = statement.exec(source)) {
    const names = match[2].includes('*') ? ['*'] : (match[2].match(/\{([^}]*)\}/)?.[1] || '').split(',').map(part => part.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    found.push({from: match[3], names});
  }
  for (const match of source.matchAll(/(?:^|\n)[ \t]*import\s*['"]([^'"]+)['"]/g)) found.push({from: match[1], names: []});
  for (const match of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push({from: match[1], names: ['*']});
  for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push({from: match[1], names: ['*']});
  return found;
}
// A relative import resolved to a repo path; a bare specifier (node:fs) stays as it is.
const resolveFrom = (file, from) => from.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), from)) : from;

const EXTENSION_PLUMBING = ['extension/flow.js', 'extension/log.js', 'extension/account-fill.js', 'extension/ladder/rung4-page-picture.js', 'extension/account-act.js', 'extension/next-step.js'];
// file -> the exact set of things it imports. `only`: for a cross-rung edge, the one binding set it may take.
export const EDGES = {
  'extension/tab-pages.js': {allow: ['extension/alias-schema.js']},
  'desktop/lib/ladder/rung1-kept.js': {allow: ['node:fs']},
  'desktop/lib/ladder/rung2-sketch.js': {allow: ['desktop/lib/ai/models.js', 'desktop/shared/alias-schema.js', 'desktop/lib/ladder/rung1-kept.js', 'desktop/lib/ladder/rung3-digest.js'], only: {'desktop/lib/ladder/rung3-digest.js': ['askDigest'], 'desktop/lib/ladder/rung1-kept.js': ['kindKey']}},
  'desktop/lib/page-kind.js': {allow: ['desktop/lib/ladder/rung1-kept.js', 'desktop/lib/ladder/rung2-sketch.js']},
  'desktop/lib/account-judge.js': {allow: ['desktop/lib/ladder/rung2-sketch.js'], only: {'desktop/lib/ladder/rung2-sketch.js': ['MODEL']}},
  'desktop/lib/ladder/rung3-digest.js': {allow: ['desktop/lib/ai/models.js']},
  'extension/ladder/rung3-candidates.js': {allow: []},
  'desktop/lib/ladder/rung4-picture.js': {allow: ['node:fs', 'desktop/lib/account-judge.js', 'desktop/lib/ladder/rung1-kept.js', 'desktop/lib/site-accounts.js'], only: {'desktop/lib/ladder/rung1-kept.js': ['pageShape'], 'desktop/lib/account-judge.js': ['accountSketch', 'listed']}},
  'extension/ladder/rung4-picture.js': {allow: EXTENSION_PLUMBING},
  'desktop/lib/ladder/rung5-takeover.js': {allow: []},
  'extension/ladder/core.js': {allow: []},
  'extension/ladder/climb.js': {allow: ['extension/ladder/core.js'], optional: true},
};
// The files that are decision rungs: another rung's file may be imported only through a listed `only` edge.
const RUNG_FILES = Object.keys(EDGES);

const edgesOf = file => importsOf(read(file)).map(item => ({...item, to: resolveFrom(file, item.from)}));

test('the import parser reads the shapes the rung files use', () => {
  const found = importsOf(`import fs from 'node:fs';\nimport {a, b as c} from './x.js';\n  import * as all from "../y.js";\nimport './side.js';\nexport {z} from './z.js';\n// import nope from './comment.js'\nconst d = await import('./dyn.js');\nconst r = require('./req.js');\nconst s = "import q from './in-a-string.js'";`);
  assert.deepEqual(found.map(item => item.from).sort(), ['./dyn.js', './req.js', './side.js', './x.js', './z.js', '../y.js', 'node:fs'].sort());
  assert.deepEqual(found.find(item => item.from === './x.js').names, ['a', 'b']);
  assert.deepEqual(found.find(item => item.from === '../y.js').names, ['*']);
});

for (const [file, rule] of Object.entries(EDGES)) {
  test(`${file}: imports exactly the allowed edges (a new edge updates the table in this file's header)`, { skip: rule.optional && !fs.existsSync(path.join(repo, file)) }, () => {
    const got = edgesOf(file);
    const targets = [...new Set(got.map(item => item.to))].sort();
    assert.deepEqual(targets, [...rule.allow].sort(), `${file} imports ${targets.join(', ') || 'nothing'}`);
    for (const [target, names] of Object.entries(rule.only || {})) {
      const taken = [...new Set(got.filter(item => item.to === target).flatMap(item => item.names))].sort();
      assert.deepEqual(taken, [...names].sort(), `${file} may take only ${names.join(', ')} from ${target}, not its internals`);
    }
  });
}

test('no rung file imports another rung file except through a listed edge with named bindings', () => {
  for (const file of RUNG_FILES.filter(one => fs.existsSync(path.join(repo, one)))) {
    for (const item of edgesOf(file).filter(one => RUNG_FILES.includes(one.to))) {
      const FACADE = file === 'desktop/lib/page-kind.js';   // the one import path for rungs 1 and 2: it re-exports both rung files whole and decides nothing
      const only = EDGES[file].only?.[item.to] || (file === 'extension/ladder/climb.js' && item.to === 'extension/ladder/core.js' ? ['*'] : null) || (FACADE ? ['*'] : null);
      assert.ok(only, `${file} reads the rung file ${item.to}`);
      assert.ok(!item.names.includes('*') || only.includes('*'), `${file} takes a whole namespace of ${item.to}`);
    }
  }
});

test('the dependency direction: digest and take-over and the router import no decision module; nothing below a rung imports a rung above it', () => {
  const decisions = ['desktop/lib/page-kind.js', 'desktop/lib/ladder/rung1-kept.js', 'desktop/lib/ladder/rung2-sketch.js', 'desktop/lib/ladder/rung4-picture.js', 'desktop/lib/account-judge.js', 'extension/tab-pages.js'];
  for (const file of ['desktop/lib/ladder/rung3-digest.js', 'desktop/lib/ladder/rung5-takeover.js', 'extension/ladder/core.js', 'extension/ladder/rung3-candidates.js']) {
    for (const item of edgesOf(file)) assert.ok(!decisions.includes(item.to), `${file} imports the decision module ${item.to}`);
  }
  // Rung 3's validator is below rung 2's caller, never the other way round.
  assert.ok(!edgesOf('desktop/lib/ladder/rung3-digest.js').some(item => ['desktop/lib/page-kind.js', 'desktop/lib/ladder/rung1-kept.js', 'desktop/lib/ladder/rung2-sketch.js'].includes(item.to)));
});

// ---- The rung map (docs/flows/ladder.md) against the code.
const map = read('docs/flows/ladder.md');
const KEYWORD = {structure: /structure/i, kept: /kept answer/i, sketch: /text sketch/i, digest: /digest/i, picture: /screenshot/i, takeover: /takes over/i, person: /the person/i};
const rows = map.split('\n').filter(line => /^\| \d \|/.test(line)).map(line => line.split('|').map(cell => cell.trim()));

test('every path the rung map names exists', () => {
  const paths = [...new Set([...map.matchAll(/`([^`\s]+\.(?:js|mjs|md|json|sh)|[^`\s]+\/)`/g)].map(match => match[1]))];
  assert.ok(paths.length > 10, 'the map names its files');
  const dirs = ['', 'extension/', 'extension/page/', 'desktop/lib/', 'desktop/', 'desktop/renderer/', 'desktop/test/'];
  const missing = paths.filter(name => !dirs.some(dir => fs.existsSync(path.join(repo, dir, name))) && !/^(npm|cd)\b/.test(name));
  assert.deepEqual(missing, [], `named in docs/flows/ladder.md but not found: ${missing.join(', ')}`);
});

test('the map has one row per rung and its numbers agree with RUNGS in ladder-core', () => {
  assert.equal(rows.length, Object.keys(RUNGS).length, 'one row per rung');
  for (const [name, number] of Object.entries(RUNGS)) {
    const row = rows.find(cells => Number(cells[1]) === number);
    assert.ok(row, `the map has no row for rung ${number} (${name})`);
    assert.match(row[2], KEYWORD[name], `rung ${number} is "${name}" in ladder-core but the map's row says "${row[2]}"`);
  }
});

test('every rung file that is in the flow core appears in the map', () => {
  const rungFlowCore = RUNG_FILES.filter(file => FLOW_CORE.includes(file));
  assert.ok(rungFlowCore.length >= 3);
  for (const file of rungFlowCore) assert.ok(map.includes(file) || map.includes(`\`${path.posix.basename(file)}\``), `${file} is in FLOW_CORE but docs/flows/ladder.md does not name it`);
});

test('every rung file of the table exists (or is the one pinned for later)', () => {
  for (const [file, rule] of Object.entries(EDGES)) assert.ok(rule.optional || fs.existsSync(path.join(repo, file)), `${file} is gone: update the table`);
});

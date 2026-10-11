// A desktop unit test must not reach playwright-core through its imports: the desktop unit job on CI installs only desktop/, not desktop/e2e (11 Oct 2026: main went red when claim-shape.test.js imported a lib that imported app.mjs for a path).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// -> the files that name playwright, reachable from `file` by relative imports (static `from '...'` and import('...') with a literal).
function reaches(file, seen = new Set(), hits = []) {
  if (seen.has(file) || !fs.existsSync(file) || !/\.(m?js)$/.test(file)) return hits;
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const found of text.matchAll(/(?:from\s+|import\s*\(\s*)'([^']+)'/g)) {
    const spec = found[1];
    if (spec.startsWith('.')) reaches(path.resolve(path.dirname(file), spec), seen, hits);
    else if (/^playwright/.test(spec)) hits.push(`${path.relative(here, file)} -> ${spec}`);
  }
  return hits;
}

test('no desktop unit test reaches playwright through its imports', () => {
  const found = fs.readdirSync(here).filter(name => name.endsWith('.test.js')).flatMap(name => reaches(path.join(here, name)).map(hit => `${name}: ${hit}`));
  assert.deepEqual(found, [], 'move the path or constant into a file that does not import playwright (the desktop unit job does not install it)');
});

test('the walker sees an import chain to playwright (positive control)', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'pw-walk-'));
  fs.writeFileSync(path.join(dir, 'a.mjs'), "import {x} from './b.mjs';\n");
  fs.writeFileSync(path.join(dir, 'b.mjs'), `import {chromium} from '${'play' + 'wright-core'}';\nexport const x = 1;\n`);   // spelled in two pieces: this file must not name the module itself
  assert.equal(reaches(path.join(dir, 'a.mjs')).length, 1);
  fs.rmSync(dir, {recursive: true, force: true});
});

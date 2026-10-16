// The Free card is its own full-width card under both engine families, in the wizard and in Settings (owner, 13 and 16 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the Free card is its own single-card group, shown under every family', () => {
  const src = read('../renderer/pages/ai-engine.js');
  const family = src.split('\n').find(l => l.includes('...FAMILY_CARDS[family]'));
  assert.ok(family && !family.includes("'free'"), 'it is not one of the family cards');
  const free = src.split('\n').find(l => l.includes("id: 'free'"));
  assert.ok(free, 'the Free card is still offered');
  assert.doesNotMatch(src.slice(src.indexOf('const free'), src.indexOf('free?.classList')), /family === 'claude'/, 'it shows under OpenAI too');
  assert.match(src, /classList\.add\('is-single'\)/);
  assert.match(read('../renderer/components.css'), /\.ui-choices\.is-single \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test('with Free picked, no Claude Code or Codex status block is drawn', () => {
  assert.match(read('../renderer/pages/ai-engine.js'), /picked !== 'free' && \(/);
});

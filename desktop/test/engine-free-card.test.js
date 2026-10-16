// The Free card is its own full-width card under both engine families, in the wizard and in Settings (owner, 13 and 16 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('Free leads as one big card, then two small logo cards for Claude and OpenAI (owner, 16 Oct 2026)', () => {
  const src = read('../renderer/pages/ai-engine.js');
  const family = src.split('\n').find(l => l.includes('FAMILY_CARDS[family].map'));
  assert.ok(family && !family.includes("'free'"), 'Free is not one of the family cards');
  assert.match(src, /id: 'free', icon: 'sparkle', title: TEXT\.free\.title, size: 'hero'/);
  assert.match(src, /logo: id[^\n]*size: 'compact'/);
  assert.ok(src.indexOf("parts.push(free,") > 0 && src.indexOf("parts.push(free,") < src.indexOf('parts.push(statusBlock'), 'Free comes first');
  assert.match(src, /classList\.add\('is-single'\)/);
  const css = read('../renderer/components.css');
  assert.match(css, /\.ui-choices\.is-single \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.ui-choice\.is-hero/);
});

test('both provider marks are in the repo, drawn as masks so they follow the text colour', () => {
  for (const name of ['claude', 'openai']) {
    assert.match(read(`../renderer/assets/ai/${name}.svg`), /^<svg[^>]*viewBox="0 0 24 24"/);
    assert.match(read('../renderer/components.css'), new RegExp(`\\.ui-logo-${name} \\{[^}]*assets/ai/${name}\\.svg`));
  }
});

test('with Free picked, no Claude Code or Codex status block is drawn', () => {
  assert.match(read('../renderer/pages/ai-engine.js'), /const aboutCli = !!family && picked === CLI_OF\[family\]/);
});

// Owner, 16 Oct 2026: Free preselected; the subscription card first (left), the API key second; technical detail folded until asked.
test('Free is preselected for a new user, and each family lists its subscription card before its API key', async () => {
  const view = await import('../renderer/ai-engine-view.js');
  assert.equal(view.chosen({}, false, 'wizard'), 'free');
  assert.equal(view.chosen({aiEngine: 'cli'}, false, 'wizard'), 'cli', 'a pick already made stays');
  assert.deepEqual(view.FAMILY_CARDS, {claude: ['cli', 'api'], openai: ['codex', 'openai']});
  const src = read('../renderer/pages/ai-engine.js');
  assert.match(src, /<summary|'summary', 'small', 'More about this'/, 'the technical rest is folded');
  assert.doesNotMatch(src, /offerCard\(\)\)/, 'no "New: run on your own Claude Code" banner');
  for (const text of Object.values(view.TEXT.families).concat(Object.values(view.TEXT.familyHint), [view.TEXT.cli.title, view.TEXT.codex.title, view.TEXT.api.title])) assert.doesNotMatch(text, /Anthropic|ChatGPT|CLI/);
});

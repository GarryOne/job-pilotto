// The AI picker keeps exactly one thing selected whatever the user clicks, on every screen that draws it (owner, 24 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {FAMILY_CARDS, afterClick, selection} from '../renderer/ai-engine-view.js';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CLICKS = ['free', 'family-claude', 'family-openai', ...Object.values(FAMILY_CARDS).flat()];
const START = [{picked: 'free', family: null}, {picked: null, family: null}, {picked: 'api', family: 'claude'}, {picked: 'openai', family: 'openai'}];

function walk(state, depth, trail, visit) {
  visit(state, trail);
  if (depth) for (const id of CLICKS) walk(afterClick(state, id), depth - 1, [...trail, id], visit);
}

test('every click sequence leaves one selection: Free alone, or a provider with at most its own method; only that method\'s box shows', () => {
  let seen = 0;
  for (const start of START) walk(start, 4, [], (state, trail) => {
    seen++;
    const {cards, keyBox, note} = selection(state), why = `${JSON.stringify(start)} then ${trail.join(' > ')}`;
    const providers = cards.filter(id => id.startsWith('family-')), methods = cards.filter(id => FAMILY_CARDS.claude.concat(FAMILY_CARDS.openai).includes(id));
    assert.ok(providers.length <= 1 && methods.length <= 1 && cards.length <= 2, `${why}: ${cards}`);
    if (cards.includes('free')) assert.deepEqual(cards, ['free'], `${why}: Free is selected with something else`);
    if (methods.length) assert.ok(FAMILY_CARDS[providers[0]?.slice(7)]?.includes(methods[0]), `${why}: a method without its own provider`);
    if (keyBox) assert.equal(keyBox, methods[0], `${why}: a key box for a card that is not selected`);
    if (note) assert.equal(note, methods[0], `${why}: a note for a card that is not selected`);
  });
  assert.ok(seen > 1000);
});

test('the three owner sequences', () => {
  // 1. Free, then Claude: Free lets go.
  assert.deepEqual(selection(afterClick({picked: 'free', family: null}, 'family-claude')).cards, ['family-claude']);
  // 2. ChatGPT + API key, then Claude: no key box left.
  const openaiKey = afterClick(afterClick({picked: null, family: null}, 'family-openai'), 'openai');
  assert.equal(selection(openaiKey).keyBox, 'openai');
  assert.equal(selection(afterClick(openaiKey, 'family-claude')).keyBox, null);
  // 3. Claude + API key, then the subscription card: it is selected at once, the key box goes, its note shows.
  const afterCli = selection(afterClick({picked: 'api', family: 'claude'}, 'cli'));
  assert.deepEqual(afterCli.cards, ['family-claude', 'cli']);
  assert.equal(afterCli.keyBox, null);
  assert.equal(afterCli.note, 'cli');
});

test('the picker draws from that model and asks nothing before selecting a card', () => {
  const src = read('../renderer/pages/ai-engine.js');
  assert.match(src, /afterClick\(/);
  assert.doesNotMatch(src, /askNotice|needsNotice/, 'the Claude Code / Codex words are a note under the card, not a confirm');
  // every screen that draws it mounts this one component
  for (const page of ['wizard.js']) assert.match(read(`../renderer/pages/${page}`), /mountEngine\(/);
  assert.match(src, /showEngineSettings/);
});

// The one "Claude ready" check (lib/claude-ready.js) and the claudeAuto switch: Claude is offered only with a Claude engine, Claude Code installed and
// signed in (and Git for Windows on Windows); "always let Claude finish" only counts when that holds. Spec docs/superpowers/specs/2026-10-10-claude-finishes-stuck-pages.md.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {claudeOffered, claudeAutoOn, _resetClaudeReady} from '../lib/claude-ready.js';

const storage = (settings = {}, secrets = {}) => ({settings: () => settings, secret: name => secrets[name]});
const ok = {claude: true, signedIn: true, git: null, windows: false};

test('offered: Claude engine + Claude Code installed and signed in', () => {
  _resetClaudeReady();
  assert.equal(claudeOffered(storage({aiEngine: 'cli'}), () => ok), true);
});

test('not offered: not installed, not signed in, Git missing on Windows, or an OpenAI/Codex engine', () => {
  for (const [why, prereqs, settings] of [
    ['not installed', {...ok, claude: false}, {aiEngine: 'cli'}],
    ['not signed in', {...ok, signedIn: false}, {aiEngine: 'cli'}],
    ['no Git on Windows', {...ok, windows: true, git: false}, {aiEngine: 'cli'}],
    ['OpenAI engine', ok, {aiEngine: 'openai'}],
    ['Codex engine', ok, {aiEngine: 'codex'}],
  ]) { _resetClaudeReady(); assert.equal(claudeOffered(storage(settings), () => prereqs), false, why); }
});

test('"always let Claude finish" counts only while Claude is offered', () => {
  _resetClaudeReady();
  assert.equal(claudeAutoOn(storage({aiEngine: 'cli', claudeAuto: true}), () => ok), true);
  assert.equal(claudeAutoOn(storage({aiEngine: 'cli'}), () => ok), false, 'off by default');
  _resetClaudeReady();
  assert.equal(claudeAutoOn(storage({aiEngine: 'cli', claudeAuto: true}), () => ({...ok, claude: false})), false);
});

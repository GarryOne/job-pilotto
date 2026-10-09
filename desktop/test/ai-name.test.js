// What the window says the AI is called follows the engine the user chose (owner, 9 Oct 2026: "handle all the Claude hard-coded in the UI"):
// renderer/ai-name.js and lib/ai/names.js give one name and model per engine, and a ratchet fails on a NEW hard-coded generic "Claude" in the
// window or the main process. What stays "Claude" is Claude-only: Apply/Read with Claude sessions, Claude Code's own texts, the Claude plan.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as windowNames from '../renderer/ai-name.js';
import * as appNames from '../lib/ai/names.js';
import {TIERS} from '../lib/ai/models.js';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');

test('one name and one model per engine, in the window and the main process, matching the model tiers', () => {
  assert.deepEqual(windowNames.NAMES, appNames.NAMES);
  assert.deepEqual(windowNames.MODELS, appNames.MODELS);
  const label = id => id.replace(/^gpt-/, 'GPT-').replace(/-([a-z])/g, (_, c) => ` ${c.toUpperCase()}`).replace(/^claude ([a-z])/i, (_, c) => `Claude ${c.toUpperCase()}`);
  for (const tier of ['small', 'main', 'big']) {
    assert.equal(windowNames.MODELS.openai[tier], label(TIERS[tier].openai), tier);
    assert.match(TIERS[tier].claude, new RegExp(windowNames.MODELS.claude[tier].split(' ')[1].toLowerCase()), tier);
  }
  assert.equal(windowNames.ai('{AI} is reviewing ({AI:big})', 'codex'), 'Codex is reviewing (GPT-6.1 Sol)');
  assert.equal(windowNames.ai('{AI} read it with {AI:main}', 'cli'), 'Claude read it with Claude Sonnet');
  assert.equal(windowNames.ai('{AI}', 'openai'), 'OpenAI');
  assert.equal(windowNames.claudeFeatures('openai'), false);
  assert.equal(windowNames.claudeFeatures('cli'), true);
  const store = engine => ({settings: () => ({aiEngine: engine}), secret: () => ''});
  assert.equal(appNames.aiText(store('codex'), '{AI} answered with {AI:small}'), 'Codex answered with GPT-6 Luna');
  assert.equal(appNames.nameOfClient({engine: 'openai'}), 'OpenAI');
  assert.equal(appNames.nameOfClient({}), 'Claude');
});

// Files allowed to say "Claude" in a string, and how many times: Claude-only features. May only shrink; a new file or a higher count fails.
const ALLOWED = {
  'renderer/pages/sessions.js': 12, 'renderer/pages/activity-visits.js': 9, 'lib/ai/names.js': 8, 'renderer/ai-name.js': 7,
  'renderer/index.html': 2, 'lib/quit-dialog.js': 4, 'renderer/pages/session-log.js': 3, 'renderer/pages/jobs-render.js': 3, 'lib/session-runs.js': 3,
  'renderer/pages/session-needs.js': 2, 'renderer/ai-engine-view.js': 2, 'lib/terminals.js': 2, 'lib/session-flow.js': 2,
  'renderer/pages/session-actions.js': 1, 'renderer/pages/claude-prereqs.js': 1, 'lib/transcript.js': 1, 'lib/session-stats.js': 1, 'lib/run-result.js': 1,
  'lib/claude-session.js': 1, 'lib/apply-handlers.js': 1, 'lib/app-reminders.js': 1, 'lib/ai/claude-code-cli.js': 1,
};
const SPECIFIC = /Claude Code|Claude in Chrome|with Claude|claude\.ai|Claude\.ai|Claude (?:subscription|plan|account|Desktop|session)|(?:Resume|Pause|Stop|Tell|Send (?:it |all \S+ )?to|Starting|Use) Claude|Claude'?s? (?:full )?report|\{AI/;

test('no new hard-coded generic "Claude" in what the window shows or the main process says (use {AI} and ai()/aiText())', () => {
  const found = {};
  const files = ['renderer', 'lib'].flatMap(dir => fs.readdirSync(path.join(root, dir), {recursive: true}).map(f => path.join(dir, f).split(path.sep).join('/')))
    .filter(f => /\.(js|html)$/.test(f) && !f.includes('gallery'));
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(root, file), 'utf8').split('\n')) {
      if (/^\s*(\/\/|\*|<!--)/.test(line)) continue;
      const code = line.replace(/\/\/ .*$/, '').replace(/<span data-ai[^>]*>[^<]*<\/span>/g, '');   // a data-ai span is filled with the chosen name
      for (const m of code.matchAll(/(['"`])((?:(?!\1).)*\bClaude\b(?:(?!\1).)*)\1|>([^<]*\bClaude\b[^<]*)</g)) {
        if (!SPECIFIC.test(m[2] ?? m[3])) found[file] = (found[file] || 0) + 1;
      }
    }
  }
  const over = Object.entries(found).filter(([file, n]) => n > (ALLOWED[file] || 0)).map(([file, n]) => `${file}: ${n} (allowed ${ALLOWED[file] || 0})`);
  assert.deepEqual(over, [], 'write {AI} through ai() (window) or aiText()/nameOfClient() (main process); Claude-only features keep "Claude"');
});

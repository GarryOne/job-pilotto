// Settings → Application assistant: "Always let Claude finish when I'm stuck" (settings.claudeAuto; spec 2026-10-10-claude-finishes-stuck-pages.md part 3).
// The line exists only while Claude is ready (claude-help.js); the stuck page's panel does the 5-second countdown (extension/panel-claude.js). Guard: test/claude-help.test.js.
import {claudeHelp} from './claude-help.js';
import {shared} from './pages/shared.js';

const $ = id => document.getElementById(id);

export function showClaudeAuto() {
  $('claude-auto-line').hidden = !claudeHelp();
  $('claude-auto').checked = !!shared.state?.settings?.claudeAuto;
}
export function wireClaudeAuto(save) {
  $('claude-auto').addEventListener('change', () => save({claudeAuto: $('claude-auto').checked}));
  window.addEventListener('claude-help', showClaudeAuto);
}

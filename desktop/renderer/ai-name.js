// The name of the AI the user chose, for every text the window shows: "Claude" (Anthropic API key, Claude Code), "OpenAI" (OpenAI API key)
// or "Codex", and its model per tier ("Claude Opus" / "GPT-6.1 Sol"). Texts write {AI} and {AI:big|main|small} and pass through ai();
// a text about a Claude-only feature (Apply with Claude, Claude Code, the Claude plan) keeps its name. The same names as lib/ai/names.js
// (the main process); test/ai-name.test.js keeps them equal and fails on a new hard-coded "Claude" in a generic text.

export const NAMES = {api: 'Claude', cli: 'Claude', openai: 'OpenAI', codex: 'Codex'};
export const MODELS = {
  claude: {small: 'Claude Haiku', main: 'Claude Sonnet', big: 'Claude Opus'},
  openai: {small: 'GPT-6 Luna', main: 'GPT-6.1 Sol', big: 'GPT-6.1 Sol'},
};
export const familyOf = engine => (engine === 'openai' || engine === 'codex' ? 'openai' : 'claude');

// The chosen engine, read from the window's state through a source pages/shared.js registers (this file stays free of the window, so
// tests import it). Nothing chosen: Claude, the default an install had before the choice existed.
let source = () => null;
export const setEngineSource = read => { source = read; };
const engineNow = () => source() || 'api';

// {AI} → the engine's name; {AI:big|main|small} → its model for that tier.
export function ai(text, engine = engineNow()) {
  const family = familyOf(engine);
  return String(text).replace(/\{AI(?::(small|main|big))?\}/g, (_, tier) => (tier ? MODELS[family][tier] : NAMES[engine] || 'Claude'));
}
export const aiName = (engine = engineNow()) => NAMES[engine] || 'Claude';
export const aiFamily = (engine = engineNow()) => familyOf(engine);
// Claude-only features (Apply with Claude, Read with Claude: Claude Code driving Chrome) are offered only for the Claude family.
export const claudeFeatures = (engine = engineNow()) => familyOf(engine) === 'claude';

// The window's static texts: <span data-ai>Claude</span> shows the engine's name, <span data-ai="big|main|small"> its model. Run at start-up and
// whenever the engine changes (pages/ai-engine.js), so index.html follows the choice like every text built in code.
export function applyAiNames(root = globalThis.document) {
  for (const span of root?.querySelectorAll?.('[data-ai]') || []) span.textContent = span.dataset.ai ? ai(`{AI:${span.dataset.ai}}`) : aiName();
}

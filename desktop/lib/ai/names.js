// The name of the AI the user chose, for the texts the main process sends to the window, toasts and dialogs: "Claude" (Anthropic API
// key, Claude Code), "OpenAI" or "Codex", and its model per tier. Texts write {AI} and {AI:big|main|small} and pass through aiText(storage,
// text). The window's twin is renderer/ai-name.js (test/ai-name.test.js keeps the two equal).
import {chosen} from './index.js';

export const NAMES = {api: 'Claude', cli: 'Claude', openai: 'OpenAI', codex: 'Codex'};
export const MODELS = {
  claude: {small: 'Claude Haiku', main: 'Claude Sonnet', big: 'Claude Opus'},
  openai: {small: 'GPT-6 Luna', main: 'GPT-6.1 Sol', big: 'GPT-6.1 Sol'},
};
const familyOf = engine => (engine === 'openai' || engine === 'codex' ? 'openai' : 'claude');

export const engineOf = storage => chosen(storage?.settings?.() || {}, {ANTHROPIC_API_KEY: storage?.secret?.('ANTHROPIC_API_KEY')}) || 'api';
export function aiText(storage, text) {
  const engine = engineOf(storage), family = familyOf(engine);
  return String(text).replace(/\{AI(?::(small|main|big))?\}/g, (_, tier) => (tier ? MODELS[family][tier] : NAMES[engine] || 'Claude'));
}
export const aiNameOf = storage => NAMES[engineOf(storage)] || 'Claude';
// The name of the engine that answered (an adapter's .engine; the raw Anthropic SDK has none: Claude).
export const nameOfClient = client => NAMES[client?.engine] || 'Claude';
export const familyOfEngine = familyOf;

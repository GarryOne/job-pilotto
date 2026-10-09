// The AI engines a user can choose (Settings → AI, the wizard's AI step), each an adapter behind one contract (contract.js), and the one
// factory the app's AI calls go through: client(storage). The app mirror of src/ai/providers/__init__.py. Nothing is chosen for the user
// and nothing switches by itself: an engine's fallback (another engine of the SAME family, billed) is used only on the user's own tick
// (settings.aiFallback), never Claude ↔ OpenAI. A new engine is one adapter file plus one row here. Guarded by test/ai-contract.test.js.
import {API, SUBSCRIPTION} from './contract.js';
import {AnthropicApi} from './anthropic-api.js';
import {ClaudeCode} from './claude-code-cli.js';
import {Codex} from './codex-cli.js';
import {OpenAiApi} from './openai-api.js';

// localOnly: runs the user's own CLI, so this computer only, never GitHub (Always on). key: the secret an API engine needs.
export const ENGINES = {
  api: {name: 'api', family: 'claude', billing: API, key: 'ANTHROPIC_API_KEY', localOnly: false, fallback: '', Adapter: AnthropicApi},
  cli: {name: 'cli', family: 'claude', billing: SUBSCRIPTION, key: '', localOnly: true, fallback: 'api', Adapter: ClaudeCode},
  openai: {name: 'openai', family: 'openai', billing: API, key: 'OPENAI_API_KEY', localOnly: false, fallback: '', Adapter: OpenAiApi},
  codex: {name: 'codex', family: 'openai', billing: SUBSCRIPTION, key: '', localOnly: true, fallback: 'openai', Adapter: Codex},
};
export const NAMES = Object.keys(ENGINES);

// The engine for this user: what they chose; an install that had an Anthropic key before the choice existed keeps 'api' (nothing is
// migrated); nothing chosen and no key: null (the wizard asks). keys: {ANTHROPIC_API_KEY, OPENAI_API_KEY} presence or values.
export function chosen(settings = {}, keys = {}) {
  if (NAMES.includes(settings.aiEngine)) return settings.aiEngine;
  return keys.ANTHROPIC_API_KEY ? 'api' : null;
}
// 'claude' | 'openai' | null: what the renderer asks (Apply with Claude is offered only for the Claude family).
export const family = (settings, keys) => ENGINES[chosen(settings, keys)]?.family || null;
// Can AI steps run: a CLI engine chosen (it says itself when it is missing), or the chosen API engine's key saved.
export function ready(settings, keys = {}) {
  const engine = ENGINES[chosen(settings, keys)];
  return !!engine && (engine.localOnly || !!keys[engine.key]);
}
// The engine GitHub runs (Always on) use for this choice: never a CLI; the family's API engine.
export const alwaysOnEngine = (settings, keys) => (family(settings, keys) === 'openai' ? 'openai' : 'api');

export const keysOf = storage => ({ANTHROPIC_API_KEY: storage.secret('ANTHROPIC_API_KEY') || '', OPENAI_API_KEY: storage.secret('OPENAI_API_KEY') || ''});

// The app's AI client for this user: an adapter for the chosen engine, or null when nothing is chosen or the Anthropic API is chosen
// without its key (callers then skip AI, as before). The CLI engines use the binary their Verify found; their fallback is the user's own tick.
export function client(storage, {only = null, ...options} = {}) {
  const settings = storage.settings(), keys = keysOf(storage);
  const name = chosen(settings, keys);
  if (!name || (only && !only.includes(name))) return null;
  const api = engineName => () => new ENGINES[engineName].Adapter({apiKey: keys[ENGINES[engineName].key], ...options});
  switch (name) {
    case 'api': return keys.ANTHROPIC_API_KEY ? api('api')() : null;
    // Always the OpenAI adapter when it is chosen, key or not (it says the key is missing): a caller holding an Anthropic key must
    // never answer instead, Claude ↔ OpenAI is never switched.
    case 'openai': return api('openai')();
    case 'cli': return new ClaudeCode({binary: settings.claudeCode?.path || '', ...options,
      fallback: settings.aiFallback && keys.ANTHROPIC_API_KEY ? api('api') : null});
    case 'codex': return new Codex({binary: settings.codex?.path || '', ...options,
      fallback: settings.aiFallback && keys.OPENAI_API_KEY ? api('openai') : null});
    default: return null;
  }
}

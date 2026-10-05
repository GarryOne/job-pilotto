// Which AI engine the app under test uses (the app's own "AI engine" setting: its API key, or the user's Claude Code on this Mac).
import {execFileSync} from 'node:child_process';

// A saved key that is never valid: with the CLI engine chosen the key is not used, and a step that needs the API engine (the AI proxy answering 429, 500, a delay)
// switches to it without spending a real key's credit, because the proxy answers or delays before anything reaches Anthropic.
export const DUMMY_KEY = 'sk-ant-api03-e2e-local-not-a-real-key-0000000000000000000000000000000000000000000000';

const claudeInstalled = () => { try { execFileSync('claude', ['--version'], {stdio: 'ignore', timeout: 20000}); return true; } catch { return false; } };

// 'api' or 'cli'. A suite may pin 'api' (it needs real API answers); E2E_AI_ENGINE overrides; CI uses the API key; a Mac with Claude Code uses it.
export function pickEngine({env = process.env, suiteEngine = '', installed = claudeInstalled} = {}) {
  if (suiteEngine === 'api') return 'api';
  const chosen = env.E2E_AI_ENGINE;
  if (chosen) { if (!['api', 'cli'].includes(chosen)) throw new Error(`E2E_AI_ENGINE must be api or cli, not "${chosen}"`); return chosen; }
  if (env.CI) return 'api';
  return installed() ? 'cli' : 'api';
}

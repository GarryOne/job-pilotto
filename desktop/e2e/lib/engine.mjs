// Which AI engine the app under test uses (the app's own "AI engine" setting: its API key, or the user's Claude Code on this Mac).
import {execFileSync} from 'node:child_process';

// A saved key that is never valid: with the CLI engine chosen the key is not used, and a step that needs the API engine (the AI proxy answering 429, 500, a delay)
// switches to it without spending a real key's credit, because the proxy answers or delays before anything reaches Anthropic.
export const DUMMY_KEY = 'sk-ant-api03-e2e-local-not-a-real-key-0000000000000000000000000000000000000000000000';

const claudeInstalled = () => { try { execFileSync('claude', ['--version'], {stdio: 'ignore', timeout: 20000}); return true; } catch { return false; } };

// THE RULE (owner, 5 Oct 2026): the e2e key is for CI only. On a Mac no suite loads, reads or spends an Anthropic key: the app under test and every judge use this Mac's
// Claude Code (the plan, a fixed price). A step that needs the proxy in front of the app (a refusal, a delay) runs on the API engine with DUMMY_KEY, so it costs nothing.
export const isCi = (env = process.env) => !!env.CI;
export const testKey = (env = process.env) => isCi(env) ? env.E2E_ANTHROPIC_KEY || '' : '';
export const appKey = (key, env = process.env) => isCi(env) ? key : DUMMY_KEY;

// The app's models under test. CI forces every step onto one cheap model (Haiku) to save credit; a Mac has no per-token cost, so the app uses its own production models
// (Haiku for the first pass, Sonnet for scoring and strategy): closer to what ships (owner, 5 Oct 2026).
export const appModelEnv = (env = process.env) => isCi(env) ? {JOB_PILOTTO_MODEL_OVERRIDE: 'claude-haiku-4-5'} : {};

// 'api' or 'cli'. CI: the API key, as it ships to users. A Mac: Claude Code, always. A suite may pin 'api' (its steps are answered by the proxy), which on a Mac runs with the
// placeholder key. E2E_AI_ENGINE=cli forces Claude Code in CI too; E2E_AI_ENGINE=api is refused on a Mac.
export function pickEngine({env = process.env, suiteEngine = '', installed = claudeInstalled} = {}) {
  const chosen = env.E2E_AI_ENGINE;
  if (chosen && !['api', 'cli'].includes(chosen)) throw new Error(`E2E_AI_ENGINE must be api or cli, not "${chosen}"`);
  if (isCi(env)) return chosen === 'cli' ? 'cli' : 'api';
  if (chosen === 'api') throw new Error('E2E_AI_ENGINE=api is for CI only: on a Mac the e2e never uses an Anthropic key (it uses Claude Code)');
  if (suiteEngine === 'api') return 'api';
  if (!installed()) throw new Error('Claude Code is not installed or not on the PATH: the e2e on a Mac runs on it (it never uses an Anthropic key). Install it and sign in with `claude`.');
  return 'cli';
}

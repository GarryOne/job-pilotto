// Which AI engine the app under test uses (the app's own "AI engine" setting: its API key, or the user's Claude Code on this Mac).
import {execFileSync} from 'node:child_process';

// A saved key that is never valid: with the CLI engine chosen the key is not used, and a step that needs the API engine (the AI proxy answering 429, 500, a delay)
// switches to it without spending a real key's credit, because the proxy answers or delays before anything reaches Anthropic.
export const DUMMY_KEY = 'sk-ant-api03-e2e-local-not-a-real-key-0000000000000000000000000000000000000000000000';

const claudeInstalled = () => { try { execFileSync('claude', ['--version'], {stdio: 'ignore', timeout: 20000}); return true; } catch { return false; } };

// THE RULE (owner, 5 Oct 2026): the e2e key is for CI only. On a Mac no suite loads, reads or spends an Anthropic key: the app under test and every judge use this Mac's
// Claude Code (the plan, a fixed price). A step that needs the proxy in front of the app (a refusal, a delay) runs on the API engine with DUMMY_KEY, so it costs nothing.
export const isCi = (env = process.env) => !!env.CI;
export const testKey = (env = process.env, engine = 'api') => isCi(env) ? env[keySecret(engine)] || '' : '';
export const appKey = (key, env = process.env) => isCi(env) ? key : DUMMY_KEY;

// The app's models under test. CI forces every step onto one cheap model (Haiku) to save credit; a Mac has no per-token cost, so the app uses its own production models
// (Haiku for the first pass, Sonnet for scoring and strategy): closer to what ships (owner, 5 Oct 2026).
export const appModelEnv = (env = process.env) => isCi(env) ? {JOB_PILOTTO_MODEL_OVERRIDE: 'claude-haiku-5-5'} : {};

// Which AI family the app under test runs on (owner, 9 Oct 2026: "make sure the OpenAI/Codex integration works well and produces good results"): CI ALTERNATES
// per run, by GitHub's run number (odd: OpenAI, even: Claude), so both families are tested every other run at today's cost; the report names the family.
// E2E_AI_FAMILY=claude|openai pins one. Without the OpenAI test key (E2E_OPENAI_KEY) an OpenAI turn runs on Claude and says so. A Mac: Claude unless pinned.
export function pickFamily(env = process.env) {
  const pinned = env.E2E_AI_FAMILY;
  if (pinned && !['claude', 'openai', 'rotate'].includes(pinned)) throw new Error(`E2E_AI_FAMILY must be claude, openai or rotate, not "${pinned}"`);
  if (pinned === 'claude' || pinned === 'openai') return pinned;
  if (!isCi(env) && pinned !== 'rotate') return 'claude';
  const turn = Number(env.GITHUB_RUN_NUMBER || 0) % 2 === 1 ? 'openai' : 'claude';
  if (turn === 'openai' && isCi(env) && !env.E2E_OPENAI_KEY) {
    console.log('  AI family: OpenAI\'s turn, but no E2E_OPENAI_KEY secret: this run uses Claude.');
    return 'claude';
  }
  return turn;
}

// 'api' | 'cli' | 'openai' | 'codex'. CI: the family's API key, as it ships to users. A Mac: the family's own CLI (Claude Code, Codex), always. A suite may pin 'api' (its
// steps are answered by the Anthropic-shaped AI proxy), which on a Mac runs with the placeholder key, whatever the family. E2E_AI_ENGINE forces one engine; an API engine is
// refused on a Mac. family: the test code's own calls (the judges, lib/model.mjs) pass 'claude', so both families are judged by the same model.
export function pickEngine({env = process.env, suiteEngine = '', installed = claudeInstalled, family = pickFamily(env)} = {}) {
  const chosen = env.E2E_AI_ENGINE;
  if (chosen && !['api', 'cli', 'openai', 'codex'].includes(chosen)) throw new Error(`E2E_AI_ENGINE must be api, cli, openai or codex, not "${chosen}"`);
  if (isCi(env)) return chosen === 'cli' || chosen === 'codex' ? chosen : chosen || (family === 'openai' ? 'openai' : 'api');
  if (chosen === 'api' || chosen === 'openai') throw new Error(`E2E_AI_ENGINE=${chosen} is for CI only: on a Mac the e2e never uses an API key (it uses Claude Code or Codex)`);
  if (suiteEngine === 'api') return 'api';
  if (chosen === 'codex' || family === 'openai') return 'codex';   // the user's own Codex (their ChatGPT plan): Verify says if it is not signed in
  if (!installed()) throw new Error('Claude Code is not installed or not on the PATH: the e2e on a Mac runs on it (it never uses an Anthropic key). Install it and sign in with `claude`.');
  return 'cli';
}
// The family of an engine, and the CI secret its API key comes from.
export const familyOf = engine => (engine === 'openai' || engine === 'codex' ? 'openai' : 'claude');
export const keySecret = engine => (familyOf(engine) === 'openai' ? 'E2E_OPENAI_KEY' : 'E2E_ANTHROPIC_KEY');
export const appSecretName = engine => (familyOf(engine) === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');

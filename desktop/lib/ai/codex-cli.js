// The Codex engine ('codex'): the app's own AI calls on the user's own signed-in Codex CLI (`codex exec`, their ChatGPT plan). The app mirror
// of src/ai/providers/codex_cli.py, on the shared CLI base (cli-base.js: temp folder, timeouts, 2 at once, one schema repair). One call is one
// `codex exec --json --ephemeral` in the call's own folder, read-only sandbox, the user's config and rules not loaded (their MCP servers, hooks
// and plugins stay out; their sign-in is still used), and every tool a text call does not need switched off by name, from the features this
// Codex lists (`codex features list`, once per binary). The system prompt leads the prompt (no flag for it); a schema goes in --output-schema
// in OpenAI's strict form; images go in -i; a PDF is a file in the folder and the shell stays on, read-only, to read it. It never reads or
// copies ~/.codex and never signs in for the user; the env drops the API keys the app holds. Billing 'subscription'.
// Guarded by test/ai-contract.test.js (recorded `codex exec --json` output, no real Codex).
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {usage as usageOf} from './contract.js';
import {CliAdapter, cliError, conversation, runProcess, slots} from './cli-base.js';
import {openaiModel} from './models.js';
import {dropNulls, strict} from './schema.js';

const VERIFY_TIMEOUT_MS = 90 * 1000;
// Off for every call (when this Codex has them): a text answer needs none of these.
export const OFF = ['unified_exec', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'image_generation',
  'multi_agent', 'multi_agent_v2', 'apps', 'plugins', 'remote_plugin', 'hooks', 'memories', 'goals', 'in_app_browser',
  'realtime_conversation', 'sleep_tool', 'tool_suggest', 'skill_search', 'skill_mcp_dependency_install', 'view_image'];
export const SHELL = 'shell_tool';   // on only to read an attached PDF (read-only sandbox, this call's folder)
const DROP_ENV = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'];
const LIMIT = /usage limit|hit your (?:usage )?limit|limit reached|rate.?limit|too many requests|\b429\b|quota/i;
const SIGNED_OUT = /not logged in|codex login|log ?in again|unauthorized|\b401\b|authentication|token (?:has )?expired|refresh token/i;
export const LIMIT_TEXT = 'Codex: your ChatGPT plan\'s usage limit is reached, so this AI step is paused; try again later, when the limit resets.';
export const SIGNED_OUT_TEXT = 'Codex is not signed in on this computer: open Terminal, run `codex login` and sign in with your ChatGPT account, '
  + 'then try again. Or switch to an OpenAI API key in Settings → AI.';
export const MISSING_TEXT = 'Codex was not found on this computer: install it (developers.openai.com/codex) and sign in with `codex login`, '
  + 'or switch to an OpenAI API key in Settings → AI.';

// Where the user's Codex may be: PATH, then where its installers put it.
export function codexSearchDirs(env = process.env, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const home = env.USERPROFILE && platform === 'win32' ? env.USERPROFILE : os.homedir();
  return [...String(env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean), p.join(home, '.local', 'bin'),
    ...(platform === 'win32' ? [env.APPDATA && p.join(env.APPDATA, 'npm')].filter(Boolean)
      : [p.join(home, '.npm-global', 'bin'), p.join(home, '.codex', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'])];
}
export function codexBinary(env = process.env, exists = fs.existsSync, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
  return codexSearchDirs(env, platform).flatMap(dir => names.map(name => p.join(dir, name))).find(file => exists(file)) || '';
}

// The user's own environment minus the keys the app holds: Codex runs on the user's sign-in. Nothing is added.
export function codexEnv(parent = process.env) {
  const env = {...parent};
  for (const name of DROP_ENV) delete env[name];
  return env;
}

// The feature names this Codex knows (`codex features list`), once per binary; an unknown name is never passed.
const featureCache = new Map();
export function features(binary, run = execFile) {
  if (!featureCache.has(binary)) {
    featureCache.set(binary, new Promise(resolve => {
      try {
        run(binary, ['features', 'list'], {timeout: 30000, env: codexEnv()}, (error, stdout) =>
          resolve(new Set(error ? [] : String(stdout || '').split('\n').map(line => line.trim().split(/\s+/)[0]).filter(Boolean))));
      } catch { resolve(new Set()); }
    }));
  }
  return featureCache.get(binary);
}

// What a failed `codex exec` said, as {kind, text} (the CLI's own error output, never page or mail content).
export function classify(text) {
  if (SIGNED_OUT.test(text || '')) return {kind: 'signed-out', text: SIGNED_OUT_TEXT};
  if (LIMIT.test(text || '')) return {kind: 'limit', text: LIMIT_TEXT};
  return {kind: 'failed', text: `Codex failed: ${String(text || 'no output').trim().slice(0, 300)}`};
}

// The JSONL events of `codex exec --json`.
export const events = stdout => String(stdout || '').split('\n').flatMap(line => {
  try { const item = JSON.parse(line); return item && typeof item === 'object' ? [item] : []; } catch { return []; }
});

export class Codex extends CliAdapter {
  static engine = 'codex';
  static family = 'openai';
  static label = 'Codex (your ChatGPT plan)';
  static fallbackLabel = 'your OpenAI API key';
  static tool = 'Codex';
  static folder = 'codex';
  static missingText = MISSING_TEXT;
  static queue = slots(2);

  constructor({run = execFile, env: parentEnv = process.env, ...options} = {}) { super(options); Object.assign(this, {run, parentEnv}); }

  env() { return codexEnv(this.parentEnv); }

  async build(request, folder, files) {
    const tier = openaiModel(request.model, request.effort, this.parentEnv);
    const known = await features(this.binary, this.run);
    const pdfs = files.filter(name => name.endsWith('.pdf'));
    const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', folder, '--ignore-user-config', '--ignore-rules', '-m', tier.model];
    for (const name of [...OFF, ...(pdfs.length ? [] : [SHELL])]) if (known.has(name)) args.push('--disable', name);
    args.push('-c', `web_search="${request.webSearch ? 'live' : 'disabled'}"`);
    if (tier.effort) args.push('-c', `model_reasoning_effort="${tier.effort === 'max' ? 'high' : tier.effort}"`);
    if (request.schema) {
      const file = path.join(folder, 'answer-schema.json');
      fs.writeFileSync(file, JSON.stringify(strict(request.schema)));
      args.push('--output-schema', file);
    }
    for (const name of files) if (!name.endsWith('.pdf')) args.push('-i', path.join(folder, name));
    let prompt = conversation(request, files);
    if (pdfs.length) prompt = `First read each attached PDF file in this folder: ${pdfs.map(name => `./${name}`).join(', ')}. Then answer.\n\n${prompt}`;
    if (request.system) prompt = `${request.system}\n\n---\n\n${prompt}`;
    return {args: [...args, '-'], prompt, native: !!request.schema};
  }

  parse({stdout, stderr, code}, folder, args = []) {
    const found = events(stdout);
    const failed = found.filter(item => item.type === 'turn.failed' || item.type === 'error');
    if (!found.length || failed.length || code !== 0) {
      const detail = failed.map(item => item.error?.message || item.message || '').join(' ');
      throw cliError(classify(`${detail}\n${stderr || ''}`.trim() || `exit code ${code}`));
    }
    const messages = found.filter(item => item.type === 'item.completed' && item.item?.type === 'agent_message').map(item => item.item.text || '');
    const used = [...found].reverse().find(item => item.type === 'turn.completed')?.usage || {};
    const model = args.includes('-m') ? args[args.indexOf('-m') + 1] : '';
    return {data: {text: messages.at(-1) || '', usage: used, model}, stop: 'end_turn'};
  }

  answer(data) { return data.text || ''; }
  normalize(value, schema) { return dropNulls(value, schema); }

  usage(data) {
    const used = data.usage || {}, cached = used.cached_input_tokens || 0;
    return {...usageOf({input: Math.max(0, (used.input_tokens || 0) - cached), output: used.output_tokens || 0, cacheRead: cached, provider: 'openai'}), model: data.model || ''};
  }
}

export const codexClient = (binary, options = {}) => new Codex({binary, ...options});

// Installed? Signed in? One tiny call (the small model, one word), on the user's own plan, only when they press Verify.
// Kept on this computer (settings.codex) for the status block and for jobs.
export async function verifyCodex(storage, {binary = codexBinary, spawnFn, now = () => new Date()} = {}) {
  const file = binary();
  let result = {installed: !!file, path: file, authenticated: false, error: file ? '' : MISSING_TEXT};
  if (file) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'job-pilotto-codex-'));
    try {
      const finished = await runProcess(file, ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', folder,
        '--ignore-user-config', '--ignore-rules', '-m', openaiModel('claude-haiku').model, '-'], 'Reply with the single word OK.',
      {cwd: folder, env: codexEnv(), timeout: VERIFY_TIMEOUT_MS, spawnFn, tool: 'Codex'});
      const found = finished.error ? [] : events(finished.stdout);
      const failed = found.filter(item => item.type === 'turn.failed' || item.type === 'error');
      const failure = finished.error || ((failed.length || finished.code !== 0)
        ? classify(`${failed.map(item => item.error?.message || item.message || '').join(' ')}\n${finished.stderr || ''}`) : null);
      // Over the plan's limit still means installed and signed in: say so, it works again later.
      result = {...result, installed: failure?.kind !== 'missing', authenticated: !failure || failure.kind === 'limit', error: failure?.text || ''};
    } finally { fs.rmSync(folder, {recursive: true, force: true}); }
  }
  storage.saveSettings({codex: {...result, checkedAt: now().toISOString()}});
  return result;
}

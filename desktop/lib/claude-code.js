// The AI engine the user chose (Settings → Connections → AI, and the setup wizard's AI step): their Anthropic API key,
// or their own Claude Code on this Mac (src/ai/engine.py runs it for the Python jobs; client() below for the app's own
// calls: the strategy draft, CV tailoring, form learning). Here: is Claude Code installed, which version, is it signed in
// (one tiny `claude -p` call, on the user's plan), and the environment a job on this Mac gets for the choice.
// Job Pilotto runs the user's OWN, unmodified, signed-in `claude`, exactly as they could run it themselves. It never
// reads, stores, logs or forwards Claude credentials, never signs in for the user, never sets auth variables for it
// (it drops the API key and the free-credit relay the app gives its own calls), and is never used by GitHub runs.
import {execFile, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Found where Apply with Claude finds it (apply.js claudeBinary), imported when needed: pipeline.js imports this module,
// and apply.js imports pipeline.js.
const claudeBinary = async () => (await import('./apply.js')).claudeBinary();

export const NOTICE = 'Job Pilotto will run your own Claude Code on this Mac. It uses your Claude plan\'s usage limits, not API credits. '
  + 'Scheduled runs in your GitHub repository (Always on) still use your API key. '
  + 'You stay in control: switch back to an API key any time.';
export const ENGINES = ['api', 'cli'];
const ALIASES = [['claude-haiku', 'haiku'], ['claude-sonnet', 'sonnet'], ['claude-opus', 'opus']];
const TIMEOUT_MS = 10 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 90 * 1000;

// The engine for this user: what they chose; an install that had an API key before the choice existed keeps 'api'
// (nothing is migrated); nothing chosen and no key: null (the wizard asks).
export function engine(settings = {}, hasKey = false) {
  if (ENGINES.includes(settings.aiEngine)) return settings.aiEngine;
  return hasKey ? 'api' : null;
}
// Can AI steps run: Claude Code chosen, or an API key saved.
export const aiReady = (settings, hasKey) => engine(settings, hasKey) === 'cli' || !!hasKey;

// What a job on this Mac gets for the choice (lib/pipeline.js pipelineEnv). GitHub runs never get these: 'api' there.
export function pipelineVariables(settings = {}, hasKey = false) {
  if (engine(settings, hasKey) !== 'cli') return {JOB_PILOTTO_AI_ENGINE: 'api'};
  return {JOB_PILOTTO_AI_ENGINE: 'cli', ...(settings.claudeCode?.path ? {JOB_PILOTTO_CLAUDE_BIN: settings.claudeCode.path} : {}),
    ...(settings.aiFallback && hasKey ? {JOB_PILOTTO_AI_FALLBACK: 'api'} : {})};
}

// Claude Code's own environment: the user's, minus what the app added for its API calls. Nothing is added.
export function cleanEnv(parent = process.env) {
  const env = {...parent};
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;
  return env;
}
export const alias = model => ALIASES.find(([prefix]) => String(model).startsWith(prefix))?.[1] || model;

// `claude --version` -> "2.1.3", or null.
export function version(binary, run = execFile) {
  return new Promise(resolve => {
    try {
      run(binary, ['--version'], {timeout: 15000, env: cleanEnv()}, (error, stdout) => resolve(error ? null : (/(\d+\.\d+\.\d+)/.exec(String(stdout))?.[1] || null)));
    } catch { resolve(null); }
  });
}
export async function detect({binary = claudeBinary, run = execFile} = {}) {
  const file = await binary();
  if (!file) return {installed: false, path: '', version: null};
  const found = await version(file, run);
  return {installed: !!found, path: file, version: found};
}

const SIGNED_OUT = /not logged in|please run \/login|run \/login|invalid api key|authentication_error|oauth token|not authenticated|login required/i;
const LIMIT = /usage limit|hit your (?:usage )?limit|limit reached|limit will reset|rate.?limit|out of (?:extra )?usage|too many requests|\b429\b/i;
export function problem(text) {
  if (SIGNED_OUT.test(text)) return {kind: 'signed-out', text: 'Claude Code is not signed in. Open Terminal, run claude and sign in with your Claude account, then Verify again.'};
  if (LIMIT.test(text)) return {kind: 'limit', text: 'Your Claude usage window is exhausted. Tasks are retried later, when your plan\'s limit resets.'};
  return {kind: 'failed', text: `Claude Code failed: ${String(text || 'no answer').trim().slice(0, 200)}`};
}

// One `claude -p … --output-format json` run: {data} or {error: {kind, text}}. The prompt goes on stdin.
export function runJson(binary, args, prompt, {cwd, timeout = TIMEOUT_MS, spawnFn = spawn} = {}) {
  return new Promise(resolve => {
    let child;
    try { child = spawnFn(binary, ['-p', '--output-format', 'json', ...args], {cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe']}); }
    catch (error) { resolve({error: {kind: 'missing', text: `Claude Code could not start: ${error.message}`}}); return; }
    let stdout = '', stderr = '', done = false;
    const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({error: {kind: 'timeout', text: `Claude Code did not answer within ${Math.round(timeout / 1000)} s`}}); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish({error: {kind: 'missing', text: `Claude Code could not start: ${error.message}`}}));
    child.on('close', code => {
      let data = null;
      try { data = JSON.parse(stdout); if (Array.isArray(data)) data = data.findLast(item => item.type === 'result'); } catch {}
      if (!data) return finish({error: problem(`${stdout}\n${stderr}`.trim() || `exit code ${code}`)});
      if (data.is_error || code !== 0 || String(data.subtype || 'success').startsWith('error')) {
        return finish({error: problem(`${data.result || ''}\n${stderr}\n${data.subtype || ''}`)});
      }
      finish({data});
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

const freshFolder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'job-pilotto-claude-'));

// Installed? Signed in? One tiny call (the haiku model, one word, no tools), on the user's own plan. The result is
// kept on this Mac (settings.claudeCode) for the status block and for jobs: the path, the version, when, ok.
export async function verify(storage, {binary = claudeBinary, run = execFile, spawnFn = spawn, now = () => new Date()} = {}) {
  const found = await detect({binary, run});
  let result;
  if (!found.installed) {
    result = {...found, authenticated: false, error: found.path ? 'Claude Code did not start (claude --version failed).'
      : 'Claude Code is not installed on this Mac. Install it from claude.com/claude-code, sign in, then Verify.'};
  } else {
    const cwd = freshFolder();
    try {
      const answer = await runJson(found.path, ['--model', 'haiku', '--tools', '', '--max-turns', '1', '--no-session-persistence'],
        'Reply with the single word OK.', {cwd, timeout: VERIFY_TIMEOUT_MS, spawnFn});
      // Over the plan's limit still means installed and signed in: say so, it works again later.
      result = {...found, authenticated: !answer.error || answer.error.kind === 'limit', error: answer.error?.text || ''};
    } finally { fs.rmSync(cwd, {recursive: true, force: true}); }
  }
  storage.saveSettings({claudeCode: {installed: result.installed, path: result.path, version: result.version,
    authenticated: result.authenticated, error: result.error, checkedAt: now().toISOString()}});
  return result;
}

// ---------- the app's own AI calls on Claude Code (a drop-in for the SDK's messages.create) ----------

const helpCache = new Map();
function offered(binary, run = execFile) {
  if (!helpCache.has(binary)) {
    helpCache.set(binary, new Promise(resolve => {
      try { run(binary, ['--help'], {timeout: 30000, env: cleanEnv()}, (error, stdout, stderr) => resolve(new Set(`${stdout || ''}${stderr || ''}`.match(/--[a-z][a-z-]+/g) || []))); }
      catch { resolve(new Set()); }
    }));
  }
  return helpCache.get(binary);
}

const EXT = {'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'};
// The conversation as one prompt; PDFs and images written into the call's own folder (the only place it may read).
export function promptAndFiles(messages, folder) {
  const files = [], parts = [];
  for (const message of messages) {
    const blocks = typeof message.content === 'string' ? [{type: 'text', text: message.content}] : message.content || [];
    const texts = [];
    for (const block of blocks) {
      if (block.type === 'text') texts.push(block.text);
      else if ((block.type === 'document' || block.type === 'image') && block.source?.type === 'base64') {
        const name = `${block.type}-${files.length + 1}.${EXT[block.source.media_type] || 'bin'}`;
        fs.writeFileSync(path.join(folder, name), Buffer.from(block.source.data, 'base64'));
        files.push(name);
        texts.push(`[attached file: ./${name}]`);
      }
    }
    parts.push(messages.length > 1 ? `${String(message.role || 'user').toUpperCase()}:\n${texts.join('\n\n')}` : texts.join('\n\n'));
  }
  const prompt = parts.join('\n\n');
  return {files, prompt: files.length ? `First read each attached file with the Read tool, in this order: ${files.map(f => `./${f}`).join(', ')}. Then answer.\n\n${prompt}` : prompt};
}
const systemText = system => (typeof system === 'string' ? system : (system || []).map(block => block.text || '').join('\n\n'));
export function parseJson(text) {
  const tries = [text, ...[...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]), String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1)];
  for (const candidate of tries) { try { return JSON.parse(candidate); } catch {} }
  throw new Error('not JSON');
}
const missingKeys = (value, schema) => (schema?.required || []).filter(key => !value || typeof value !== 'object' || !(key in value));

// {messages: {create(params)}} on the user's Claude Code, answering like the SDK: content[0].text, usage (billing:
// 'subscription', so the app shows no API cost), stop_reason, model. A JSON-schema answer is checked, and asked again once.
export function cliClient(binary, {spawnFn = spawn, run = execFile, timeout = TIMEOUT_MS} = {}) {
  async function create({model, system, messages, output_config: config = {}}) {
    if (!binary) throw new Error('Claude Code is not installed on this Mac: install it, or switch to an API key in Settings → Connections → AI.');
    const flags = await offered(binary, run);
    const schema = config.format?.type === 'json_schema' ? config.format.schema : null;
    const cwd = freshFolder();
    try {
      const {prompt, files} = promptAndFiles(messages, cwd);
      const args = ['--model', alias(model)];
      if (system) args.push('--system-prompt', systemText(system));
      args.push('--tools', files.length ? 'Read' : '');
      if (files.length) args.push('--allowedTools', 'Read(./**)');
      if (flags.has('--permission-mode')) args.push('--permission-mode', 'dontAsk');
      const native = !!schema && flags.has('--json-schema');
      if (native) args.push('--json-schema', JSON.stringify(schema));
      if (config.effort && flags.has('--effort')) args.push('--effort', config.effort);
      for (const flag of ['--no-session-persistence', '--strict-mcp-config', '--safe-mode']) if (flags.has(flag)) args.push(flag);
      // Leaner by default (measured 8 Oct 2026, a one-word call on Haiku): the user's skills, slash commands and settings are not loaded into a call that needs none of them:
      // 7,473 -> 651 tokens of context and about 0.4 s less per call; every page-kind, form and mail decision pays this on every call, and the tokens count on the plan.
      if (flags.has('--disable-slash-commands')) args.push('--disable-slash-commands');
      if (flags.has('--setting-sources')) args.push('--setting-sources', '');
      const ask = async text => {
        const answer = await runJson(binary, args, text, {cwd, timeout, spawnFn});
        if (answer.error) throw Object.assign(new Error(answer.error.text), {kind: answer.error.kind});
        return answer.data;
      };
      const asked = schema && !native ? `${prompt}\n\nAnswer with only one JSON object (no prose, no code fence) matching this JSON schema:\n${JSON.stringify(schema)}` : prompt;
      let data = await ask(asked);
      const textOf = d => (schema && d.structured_output != null ? JSON.stringify(d.structured_output) : String(d.result || ''));
      let text = textOf(data), usage = data.usage || {};
      if (schema) {
        let value = null;
        try { value = parseJson(text); } catch {}
        if (!value || missingKeys(value, schema).length) {  // repaired once, never a loop
          data = await ask(`${asked}\n\nYour previous answer was not valid JSON for the schema:\n${text.slice(0, 6000)}\n\nAnswer again with only the corrected JSON object.`);
          text = textOf(data);
          usage = {input_tokens: (usage.input_tokens || 0) + (data.usage?.input_tokens || 0), output_tokens: (usage.output_tokens || 0) + (data.usage?.output_tokens || 0)};
          try { value = parseJson(text); } catch { value = null; }
          if (!value || missingKeys(value, schema).length) throw new Error('Claude Code gave no valid answer for this step (twice)');
        }
        text = JSON.stringify(value);
      }
      return {content: [{type: 'text', text}], model, stop_reason: data.subtype === 'error_max_turns' ? 'max_turns' : 'end_turn',
        usage: {input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0,
          cache_read_input_tokens: usage.cache_read_input_tokens || 0, billing: 'subscription'}};
    } finally { fs.rmSync(cwd, {recursive: true, force: true}); }
  }
  return {messages: {create}, engine: 'cli'};
}

// The app's own AI client for this user: Claude Code when they chose it, else null (the caller uses the API key).
export function client(storage, options = {}) {
  const settings = storage.settings();
  if (engine(settings, !!storage.secret('ANTHROPIC_API_KEY')) !== 'cli') return null;
  return cliClient(settings.claudeCode?.path || '', options);  // the path Verify found
}

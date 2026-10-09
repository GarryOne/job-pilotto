// What every engine that runs the user's own signed-in CLI shares (Claude Code `claude -p`, Codex `codex exec`): the app mirror of
// src/ai/providers/cli_base.py. The user's OWN, unmodified, already signed-in binary runs exactly as they could run it themselves, on their
// plan's limits, not API credits. Nothing here reads, copies, stores, logs or forwards the CLI's credentials, sets auth variables for it
// (each subclass's env() drops the API keys the app holds), or signs in for the user. Each call gets a fresh temp folder (its working
// directory and the only place the CLI may read: attached images/PDFs are written there), a hard timeout, at most 2 processes at once per
// CLI, and one repair when a structured answer does not match its schema. A subclass says how to call its binary (build, parse, answer,
// usage). Guarded by test/ai-contract.test.js (both CLIs) and test/claude-code.test.js.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Adapter, AiError, AiLimit, SUBSCRIPTION, attachments, plus, response} from './contract.js';
import {parseJson, problems} from './schema.js';

export const TIMEOUT_MS = 10 * 60 * 1000;
const TIMEOUTS_BEFORE_STOP = 2;  // in a row: the CLI is not answering at all, so nothing waits again in this run
const EXT = {'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'};

// A CLI's own failure, with its kind ('limit' | 'signed-out' | 'missing' | 'timeout' | 'failed'): the first three are AiLimit.
export function cliError({kind, text}) {
  const error = ['limit', 'signed-out', 'missing'].includes(kind) ? new AiLimit(text, {final: kind !== 'limit'}) : new AiError(text);
  return Object.assign(error, {kind});
}

// The request's images/PDFs written into folder, in order: their names (image-1.png, document-2.pdf).
export function writeFiles(request, folder) {
  return attachments(request).map((part, i) => {
    const name = `${part.kind === 'image' ? 'image' : 'document'}-${i + 1}.${EXT[part.mediaType] || 'bin'}`;
    fs.writeFileSync(path.join(folder, name), Buffer.from(part.data, 'base64'));
    return name;
  });
}

// The messages as one prompt; an attachment becomes `[attached file: ./<name>]` where it was.
export function conversation(request, names = []) {
  const files = names[Symbol.iterator](), many = request.messages.length > 1;
  return request.messages.map(message => {
    const text = message.parts.filter(part => typeof part !== 'string' || part)
      .map(part => (typeof part === 'string' ? part : `[attached file: ./${files.next().value}]`)).join('\n\n');
    return many ? `${String(message.role).toUpperCase()}:\n${text}` : text;
  }).join('\n\n');
}

// One process: {stdout, stderr, code}, or {error: {kind: 'timeout' | 'missing', text}}. The prompt goes on stdin.
export function runProcess(binary, args, prompt, {cwd, env, timeout = TIMEOUT_MS, spawnFn = spawn, tool = 'The AI'} = {}) {
  return new Promise(resolve => {
    let child;
    try { child = spawnFn(binary, args, {cwd, env, stdio: ['pipe', 'pipe', 'pipe']}); }
    catch (error) { resolve({error: {kind: 'missing', text: `${tool} could not start: ${error.message}`}}); return; }
    let stdout = '', stderr = '', done = false;
    const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({error: {kind: 'timeout', text: `${tool} did not answer within ${Math.round(timeout / 1000)} s`}}); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish({error: {kind: 'missing', text: `${tool} could not start: ${error.message}`}}));
    child.on('close', code => finish({stdout, stderr, code}));
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

// At most `size` callers at once; the rest wait their turn.
export function slots(size = 2) {
  let busy = 0;
  const waiting = [];
  return async work => {
    if (busy >= size) await new Promise(resolve => waiting.push(resolve));
    busy += 1;
    try { return await work(); } finally { busy -= 1; waiting.shift()?.(); }
  };
}

export class CliAdapter extends Adapter {
  static billing = SUBSCRIPTION;
  static tool = '';      // the CLI's name, in words ("Claude Code")
  static folder = '';    // the call folders' name: job-pilotto-<folder>-…
  static missingText = '';

  constructor({binary = '', timeout = TIMEOUT_MS, spawnFn = spawn, ...options} = {}) {
    super(options);
    Object.assign(this, {binary, timeout, spawnFn, timeouts: 0});
  }

  // ----- what a subclass says -----
  async build(request, folder, files) { throw new Error('not implemented'); }
  parse(finished, folder, args) { throw new Error('not implemented'); }   // {data, stop} or throws
  answer(data, schema) { throw new Error('not implemented'); }
  usage(data) { throw new Error('not implemented'); }
  normalize(value, schema) { return value; }   // a structured answer back in the caller's schema's shape
  env() { return {...process.env}; }

  // ----- shared -----
  async call(args, prompt, folder) {
    const {tool} = this.constructor;
    if (!this.binary) throw cliError({kind: 'missing', text: this.constructor.missingText});
    if (this.timeouts >= TIMEOUTS_BEFORE_STOP) throw cliError({kind: 'limit', text: `${tool} is not answering (it timed out twice in a row); this run stops here.`});
    const finished = await this.constructor.queue(() => runProcess(this.binary, args, prompt,
      {cwd: folder, env: this.env(), timeout: this.timeout, spawnFn: this.spawnFn, tool}));
    if (finished.error?.kind === 'timeout') {
      this.timeouts += 1;
      if (this.timeouts >= TIMEOUTS_BEFORE_STOP) throw cliError({kind: 'limit', text: `${finished.error.text}, twice in a row; this run stops here.`});
    } else this.timeouts = 0;
    if (finished.error) throw cliError(finished.error);
    return this.parse(finished, folder, args);
  }

  async complete(request) {
    const {tool, folder: name} = this.constructor;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), `job-pilotto-${name || this.engine}-`));
    try {
      const files = writeFiles(request, folder);
      const {args, prompt: base, native} = await this.build(request, folder, files);
      const schema = request.schema;
      const prompt = schema && !native
        ? `${base}\n\nAnswer with only one JSON object (no prose, no code fence) matching this JSON schema:\n${JSON.stringify(schema)}` : base;
      let {data, stop} = await this.call(args, prompt, folder);
      let used = this.usage(data), text = this.answer(data, schema);
      if (schema && stop === 'end_turn') {
        const check = candidate => { try { const value = this.normalize(parseJson(candidate), schema); return {value, found: problems(value, schema)}; } catch { return {value: null, found: ['not JSON']}; } };
        let {value, found} = check(text);
        if (found.length) {  // repaired once, never a loop
          this.log(`Warning: ${tool} answer did not match the schema (${found.slice(0, 3).join('; ')}); asking once more`);
          ({data, stop} = await this.call(args, `${prompt}\n\nYour previous answer was not valid (${found.slice(0, 5).join('; ')}):\n${String(text).slice(0, 6000)}\n\nAnswer again with only the corrected JSON object.`, folder));
          used = plus(used, this.usage(data));
          text = this.answer(data, schema);
          ({value, found} = check(text));
          if (found.length) throw cliError({kind: 'failed', text: `${tool} gave no valid answer for this step (twice)`});
        }
        text = JSON.stringify(value);
      }
      return response({text, usage: used, model: request.model, stopReason: stop, engine: this.engine});
    } finally { fs.rmSync(folder, {recursive: true, force: true}); }
  }
}

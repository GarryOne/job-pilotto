// The contract every AI engine adapter meets in the app: Anthropic-shaped params in, one SDK-shaped response out, one set of errors.
// The app mirror of src/ai/providers/contract.py (same names, camelCase): callers keep calling `client.messages.create(params)` with
// the params they always sent (model, max_tokens, system, messages, output_config, tools). `Adapter.create` turns them into a neutral
// request (refusing any param it does not know, so nothing is dropped in silence), hands it to the engine's `complete`, and returns
// {content: [{type: 'text', text}], usage, stop_reason, model}: the app's AI modules work the same whatever the engine.
// Errors: AiUnavailable (transient: down or busy), AiLimit (aiLimit: a plan or spend limit, not signed in, not installed), AiError.
// Guarded by test/ai-contract.test.js (every adapter, the same request).

export const API = 'api', SUBSCRIPTION = 'subscription';
export const STOP_REASONS = ['end_turn', 'max_tokens', 'refusal', 'max_turns'];
export const PARAMS = ['model', 'max_tokens', 'system', 'messages', 'output_config', 'tools'];

// ---------- errors ----------
export class AiError extends Error { constructor(text, options) { super(text, options); this.name = 'AiError'; } }
// Transient: the provider is down, overloaded or rate-limited after its own retries. The run stops; the next one continues.
export class AiUnavailable extends AiError { constructor(text, options) { super(text, options); this.name = 'AiUnavailable'; } }
// The user's plan or spend limit, or an engine that cannot run (not signed in, not installed). final: no fallback can help.
export class AiLimit extends AiError {
  constructor(text, {final = false, ...options} = {}) { super(text, options); this.name = 'AiLimit'; this.aiLimit = true; this.final = final; }
}

// ---------- the request ----------
// The text blocks of an Anthropic-shaped content (a string, or a list of blocks).
export const textOf = content => (typeof content === 'string' ? content
  : (content || []).filter(block => block?.type === 'text').map(block => block.text || '').join('\n\n'));

// The neutral request for Anthropic-shaped params: {model, system, messages: [{role, parts}], maxTokens, schema, effort, webSearch, params}.
// A part is a string (text) or {kind: 'image'|'pdf', mediaType, data (base64)}. Throws TypeError for anything the contract does not carry.
export function requestFrom(params = {}) {
  const unknown = Object.keys(params).filter(key => !PARAMS.includes(key)).sort();
  if (unknown.length) throw new TypeError(`not part of the AI contract (desktop/lib/ai/contract.js): ${unknown.join(', ')}`);
  if (!params.model) throw new TypeError('model is required');
  let webSearch = 0;
  for (const tool of params.tools || []) {
    if (!String(tool?.type || '').startsWith('web_search')) throw new TypeError(`only the web search tool is part of the AI contract, not ${JSON.stringify(tool?.type)}`);
    webSearch = Math.max(webSearch, Number(tool.max_uses) || 1);
  }
  const config = params.output_config || {};
  const extra = Object.keys(config).filter(key => !['format', 'effort'].includes(key)).sort();
  if (extra.length) throw new TypeError(`output_config: not part of the AI contract: ${extra.join(', ')}`);
  const shape = config.format || null;
  if (shape && shape.type !== 'json_schema') throw new TypeError(`output_config.format: only json_schema is part of the AI contract, not ${JSON.stringify(shape.type)}`);
  const messages = (params.messages || []).map(message => {
    const blocks = typeof message.content === 'string' ? [{type: 'text', text: message.content}] : message.content || [];
    const parts = blocks.map(block => {
      if (block?.type === 'text') return block.text || '';
      if ((block?.type === 'image' || block?.type === 'document') && block.source?.type === 'base64') {
        return {kind: block.type === 'image' ? 'image' : 'pdf', mediaType: block.source.media_type || '', data: block.source.data || ''};
      }
      throw new TypeError(`a message block of type ${JSON.stringify(block?.type)} (${JSON.stringify(block?.source?.type)}) is not part of the AI contract`);
    });
    return {role: message.role || 'user', parts};
  });
  return {model: params.model, system: params.system ? textOf(params.system) : '', messages, maxTokens: Number(params.max_tokens) || 0,
    schema: shape ? shape.schema : null, effort: config.effort || null, webSearch, params};
}
export const attachments = request => request.messages.flatMap(message => message.parts.filter(part => typeof part !== 'string'));

// ---------- the response, shaped like the Anthropic SDK's ----------
export function usage({input = 0, output = 0, cacheRead = 0, cacheWrite = 0, billing = SUBSCRIPTION, provider = ''} = {}) {
  return {input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, billing, provider};
}
export const plus = (a, b) => ({...a, input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens,
  cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens});
export const response = ({text, usage: used, model, stopReason = 'end_turn', engine = ''}) =>
  ({content: [{type: 'text', text}], usage: used, model, stop_reason: stopReason, engine});

// ---------- the adapter ----------
// One engine behind the contract. A subclass sets the static fields and implements `async complete(request)`.
// fallback: a function returning another client of the SAME family (the user's own tick, e.g. "If Claude Code hits my plan's limit,
// use my API key"); after an AiLimit that is not final, the rest of this client's life goes there (`fellBack`).
export class Adapter {
  static engine = '';      // 'api' | 'cli' | 'openai' | 'codex'
  static family = '';      // 'claude' | 'openai'
  static billing = API;
  static label = '';       // how a call is paid for, in words
  static fallbackLabel = '';
  static readsPdf = true;  // takes a PDF attachment as it is (Codex: no, see codex-cli.js)

  constructor({fallback = null, log = text => console.warn(text)} = {}) {
    this.fallback = fallback;
    this.log = log;
    this.fallen = null;
    this.messages = {create: params => this.create(params)};
  }
  get engine() { return this.constructor.engine; }
  get family() { return this.constructor.family; }
  get billing() { return this.constructor.billing; }
  get fellBack() { return this.fallen !== null; }

  async create(params) {
    const request = requestFrom(params);
    if (this.fallen) return this.fallen.messages.create(params);
    try {
      return await this.complete(request);
    } catch (error) {
      if (!(error instanceof AiLimit) || error.final || !this.fallback) throw error;
      this.log(`Warning: ${error.message} Using ${this.constructor.fallbackLabel} for the rest of this run (Settings → AI).`);
      this.fallen = this.fallback();
      return this.fallen.messages.create(params);
    }
  }

  async complete(request) { throw new Error('not implemented'); }
}

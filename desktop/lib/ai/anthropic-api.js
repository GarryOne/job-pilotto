// The Anthropic API engine ('api'): the user's ANTHROPIC_API_KEY through the official SDK, the only `new Anthropic` in the app
// (test/ai-contract.test.js fails on one elsewhere). Lossless: the caller's params go to the SDK untouched (cache_control kept), and the
// SDK's answer and errors come back as they are, with usage.billing 'api'. The free AI credit (lib/ai-trial.js) still works: the SDK
// follows ANTHROPIC_BASE_URL itself, so no baseURL is set here.
import Anthropic from '@anthropic-ai/sdk';
import {API, Adapter, requestFrom} from './contract.js';

export class AnthropicApi extends Adapter {
  static engine = 'api';
  static family = 'claude';
  static billing = API;
  static label = 'your Anthropic API key';

  constructor({apiKey, sdk = null, fetch = undefined, ...options} = {}) {
    super(options);
    this.sdk = sdk || new Anthropic({apiKey, ...(fetch ? {fetch} : {})});
    // Streaming stays the SDK's own (the strategy draft's progress bar); only this engine offers it, callers check for it.
    this.messages.stream = params => { requestFrom(params); return this.sdk.messages.stream(params); };
  }

  async complete(request) {
    const answer = await this.sdk.messages.create(request.params);
    if (answer?.usage) Object.assign(answer.usage, {billing: API, provider: 'anthropic'});
    return answer;
  }
}

// The app's client on an Anthropic key, for the callers that were given one (`client || anthropicApi(apiKey)`).
export const anthropicApi = (apiKey, options = {}) => new AnthropicApi({apiKey, ...options});

// Is this key valid? A free call (list one model), always at Anthropic itself, never the free-credit relay.
export async function checkAnthropicKey(apiKey, {Sdk = Anthropic} = {}) {
  await new Sdk({apiKey, baseURL: 'https://api.anthropic.com'}).models.list({limit: 1});
}

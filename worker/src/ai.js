// The Worker's AI client: the Anthropic SDK on the Worker's own ANTHROPIC_API_KEY (the Cloudflare deploy stays Anthropic-only). The desktop
// app injects its own client instead (lib/ai/index.js: whatever engine the user chose), so this is used only when none is given.
import Anthropic from '@anthropic-ai/sdk';

// Workers need the global fetch bound at call time (not captured at import), hence the wrapper.
export const anthropicClient = apiKey => new Anthropic({ apiKey, fetch: (...args) => globalThis.fetch(...args) });

// The price per million tokens for a call's usage (the same as desktop/lib/ai/models.js priceOf, kept equal by its test): an OpenAI
// call injected by the desktop app is priced as its own model, everything else at the caller's Claude price.
export const OPENAI_PRICES = { 'gpt-6-luna': { input: 0.10, cachedInput: 0.01, output: 0.50 }, 'gpt-6.1-sol': { input: 2.00, cachedInput: 0.10, output: 10.00 } };
export const priceOf = (usage, claudePrice) => (usage?.provider === 'openai' ? OPENAI_PRICES[usage.model] || OPENAI_PRICES['gpt-6.1-sol'] : claudePrice);

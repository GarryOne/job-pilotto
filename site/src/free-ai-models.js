// Which Workers AI model answers which AI step of the Free engine, and what a call costs us (USD per million tokens, Cloudflare list prices).
// The names here come from tools/free-ai-eval.mjs (spec 2026-10-16-free-workers-ai.md "Quality"), not from a shortlist.
export const SMALL = '@cf/qwen/qwen3-30b-a3b-fp8';
export const STRONG = '@cf/zai-org/glm-5.3-flash';   // needs the Workers Paid plan; until it is on, STRONG_ON=off keeps these steps on SMALL
const PRICES = {[SMALL]: [0.0509, 0.335], [STRONG]: [0.15, 0.5]};

// Steps that read a page, a mail or a job (short, structured answers) run on the small model; writing a CV, a kit, a strategy or an answer for a form runs on the stronger one.
const STRONG_STEPS = new Set(['kit', 'prep', 'insight', 'interview', 'opportunity', 'review']);

export const modelFor = (action, env = {}) => (STRONG_STEPS.has(String(action)) && env.STRONG_ON === 'on' ? STRONG : SMALL);

export function costUsd(model, usage = {}) {
  const [input, output] = PRICES[model] || [0.5, 1.5];   // an unknown model is charged like a dear one so it can never dodge the daily line
  return ((usage.input_tokens || 0) * input + (usage.output_tokens || 0) * output) / 1e6;
}

// The Workers Free plan answers up to 10,000 neurons a day (resets 00:00 UTC); 1 neuron = $0.000011, so a call's neurons follow from its cost. Past it Cloudflare refuses until the next day.
export const FREE_NEURONS_PER_DAY = 10_000;
export const NEURON_USD = 0.000011;
export const neuronsOf = usd => usd / NEURON_USD;

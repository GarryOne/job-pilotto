// The fast format first, the strict one on doubt (apply-latency B, owner 11 Oct 2026): for the page-kind question only, Claude Code is asked with the schema
// stated in the prompt (no --json-schema: ~2.3 s less per ask, measured 5.8 -> 3.5 s), the adapter validates the answer against the schema as always, and
// an answer that fails validation or is below ACCEPT confidence is asked again with the native schema. Measured on the 132 ladder fixtures before landing
// (the account judges lost with the fast format and stay strict). Used by server-pages.js decidePageKind and e2e/lib/ladder-score-path.mjs alike.
// Guard: test/fast-first.test.js.
export const ACCEPT = 0.85;
// The page-kind question by its schema (lib/ladder/rung2-sketch.js SCHEMA names apply_button); the digest and every judge go strict.
export const isPageKind = params => !!params?.output_config?.format?.schema?.properties?.apply_button;
// Kept from the fast format: a confident answer that hands nothing to the person. A bot check sends the page to the person, so the strict format confirms it
// (live Recruitee run, 11 Oct 2026: one fast draw called the form's frame a bot check at 0.85; the extension's floor caught it, the strict re-ask is the real fix).
export const confident = answer => Number(answer?.confidence) >= ACCEPT && answer?.bot_check !== true;

// -> a client: {messages: {create}}. fast / strict: clients of the same engine; when(params): this question may go fast; accept(answer): keep it.
export function fastFirst({fast, strict, when = isPageKind, accept = confident}) {
  if (!fast || !strict || fast.engine !== 'cli') return strict || fast;   // only Claude Code has the two formats
  return {engine: strict.engine, messages: {create: async params => {
    if (!when(params)) return strict.messages.create(params);
    try {
      const response = await fast.messages.create(params);
      const text = response?.content?.find(block => block.type === 'text')?.text;
      if (response?.stop_reason !== 'max_tokens' && accept(JSON.parse(text))) return response;
    } catch { /* invalid twice, or a failure: the strict ask below says the real error */ }
    return strict.messages.create(params);
  }}};
}

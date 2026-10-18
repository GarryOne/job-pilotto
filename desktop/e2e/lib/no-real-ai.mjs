// Counts the AI calls of a test run that went on to a real model; a suite whose AI is all stand-in ends with a step that fails when any did (strategy, 18 Oct 2026: it reached gpt-6-luna).
export const realAiCalls = ctx => (ctx.proxy?.stats.paid || 0) + (ctx.openaiProxy?.stats.paid || 0);

// Throws, naming the count, when a call was paid for.
export function assertNoRealAi(ctx) {
  const paid = realAiCalls(ctx);
  if (paid) throw new Error(`${paid} AI call(s) reached a real model although this suite's stand-in should answer every one (see the "ai-proxy refusal" lines above, or the AI cost lines)`);
}

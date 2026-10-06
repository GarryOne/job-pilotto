// Did the fault a step set up actually fire? (6 Oct 2026, #306.) A step that breaks a service on purpose (the AI proxy's setMode, the Notion proxy's fail, the fake Telegram's
// fail, the fake Google's revoke) proves something only if that service then answered with a failure. #306 armed a kit-draft failure that never reached the app: the kit was
// drafted, the form opened as it should, and the step was filed as a product bug. The runner now compares each fake's counters around every step: armed during the step (or a
// `faults: true` step) and no failure served = the setup did not take effect, or the app never called that service. Said in the step's message, so neither the verdict pass nor a
// person blames the app first; a step that PASSES that way is warned about (it may be testing nothing). Pure.
export const tally = fakes => fakes.filter(fake => fake?.stats).reduce((sum, fake) =>
  ({armed: sum.armed + (fake.stats.armed || 0), failed: sum.failed + (fake.stats.failed || 0)}), {armed: 0, failed: 0});

export const NEVER_FIRED = 'the fault this step set up never fired';
// '' or NEVER_FIRED, from the tallies before and after a step.
export function faultCheck(before, after, {faults = false} = {}) {
  if (!before || !after) return '';
  if (!faults && !(after.armed > before.armed)) return '';
  return after.failed > before.failed ? '' : NEVER_FIRED;
}
export const neverFiredNote = `[harness check: ${NEVER_FIRED}: no fake service (AI, Notion, Telegram, Google) answered with a failure while the step ran, so either the test's setup did not take effect or the app never called that service]`;

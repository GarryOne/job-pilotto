// Setup funnel: each install reports, once per step, the furthest setup step it reached (and when setup finished),
// as a technical report of kind "setup" (lib/telemetry.js; off when reports are off). The owner's /telemetry page
// shows where people stop. Anonymous: the step, its number, minutes since the first start, which AI path was taken.
export const STEPS = ['welcome', 'ai', 'notion', 'cv', 'draft', 'extras'];  // = renderer/pages/core.js STEPS

// The report for this settings change, or null: a step further than before, or setup finished for the first time.
export function track(patch, before, now = Date.now()) {
  const furthest = STEPS.indexOf(before.setupFurthest);
  const minutes = before.firstRunAt ? Math.max(0, Math.round((now - Date.parse(before.firstRunAt)) / 60000)) : null;
  const ai = before.aiTrial || patch.aiTrial ? 'trial' : 'own';
  if (patch.setupDone === true && !before.setupDone) return {step: 'done', index: STEPS.length, minutes, ai};
  const index = STEPS.indexOf(patch.wizardStep);
  if (index > furthest) return {step: patch.wizardStep, index, minutes, ai};
  return null;
}

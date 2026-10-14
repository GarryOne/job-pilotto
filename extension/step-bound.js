// A deadline for one awaited step of the fill (a debugger command, a page call, an AI pick): one control that never answers must not hold back the rest of the fill (14 Oct 2026, 5afa5a8: a suggest-only combobox held the late answers' pass for 40 s, then "dead end: silent"). Guard: desktop/test/step-bounds.test.js.
export class StepTimeout extends Error {
  constructor(label, ms) { super(`${label} did not answer in ${ms} ms`); this.step = label; this.ms = ms; }
}
// work() raced against a timer. The work itself cannot be cancelled: the caller stops using its result and detaches whatever it holds (the debugger).
export function within(ms, label, work) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new StepTimeout(label, ms)), ms); });
  return Promise.race([Promise.resolve().then(work), late]).finally(() => clearTimeout(timer));
}

// Two small guards for the replay refill (16 Oct 2026, run 38819507828): a GitHub upload that fails once is tried again, and a row whose fill asked nothing has nothing to refill. Pure.
// Guard: e2e/test/refill-resilience.test.mjs.

// Run `action` up to `tries` times; `wait(ms)` between tries (default a real pause). Throws the last error.
export function withRetry(action, {tries = 3, delayMs = 4000, wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)} = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return action(); } catch (error) { if (attempt >= tries) throw error; wait(delayMs * attempt); }
  }
}

// fill-memo's log: "<row> check (no model): 0/0 live asks answered": the row stopped before any question (a posting with no form), so no model-memo.json exists and none is needed.
export const nothingToRefill = log => /fill-memo: .*: 0\/0 live asks answered/.test(String(log));

// Pre-started CLI processes for the page's questions (apply-latency change 2, owner 11 Oct 2026): a `claude -p` takes ~2 s to start before it
// can read a prompt, so the adapter keeps one already-started process per kind of question (same args: model, system prompt, schema) and
// hands the next such question to it (measured: 1.1-1.7 s instead of 2.6-3.3 s for a page-kind ask). ONE process per question: a spare
// answers one prompt and exits, it never sees an earlier page (a long-lived process was rejected: the model would see earlier pages).
// A spare not used within `idleMs` is killed; at most `max` wait at once; all are killed when the app exits. Guard: test/cli-spares.test.js.
export function sparePool({max = 3, idleMs = 45000} = {}) {
  const waiting = new Map();   // key -> {child, timer}
  const drop = key => {
    const spare = waiting.get(key);
    if (!spare) return;
    waiting.delete(key);
    clearTimeout(spare.timer);
  };
  const kill = key => { const spare = waiting.get(key); drop(key); try { spare?.child.kill('SIGKILL'); } catch { /* already gone */ } };
  let hooked = false;
  return {
    // The started process for this kind of question, or null (then the caller starts one as before).
    take(key) {
      const spare = waiting.get(key);
      drop(key);
      return spare && spare.child.exitCode === null && !spare.child.killed ? spare.child : null;
    },
    // Starts a spare for the next question of this kind, unless one waits already or `max` do. start() -> a child process.
    keep(key, start) {
      if (waiting.has(key) || waiting.size >= max) return;
      let child;
      try { child = start(); } catch { return; }
      child.on?.('error', () => { if (waiting.get(key)?.child === child) drop(key); });
      child.on?.('exit', () => { if (waiting.get(key)?.child === child) drop(key); });
      const timer = setTimeout(() => kill(key), idleMs);
      timer.unref?.();
      waiting.set(key, {child, timer});
      if (!hooked) { hooked = true; process.once('exit', () => { for (const key of [...waiting.keys()]) kill(key); }); }
    },
    size: () => waiting.size,
    clear: () => { for (const key of [...waiting.keys()]) kill(key); },
  };
}

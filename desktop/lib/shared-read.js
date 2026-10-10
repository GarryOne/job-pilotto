// A read asked again while the same read runs joins it instead of starting another Python run (7 Oct 2026: ~10 job-list
// reads ran at once, 60 s each, and slowed every other read, Interviews' library to 20-30 s). Reads only: never a write.
// A write that finished (readsChanged / afterWrite) closes the join: a read that began before it may hold the old data, so the
// next ask starts its own (#325: a job marked Applied came back with its old status from a read started before the write).
let generation = 0;
export const readsChanged = () => { generation += 1; };
export const afterWrite = handler => async (...args) => { try { return await handler(...args); } finally { readsChanged(); } };

export function sharedRead(name, read, {keyOf = () => '', log = () => {}} = {}) {
  const running = new Map();
  return (...args) => {
    const key = String(keyOf(...args) ?? '');
    const joinable = running.get(key);
    if (joinable?.generation === generation) { log('run', `joined the running ${name} read`, key ? {key} : undefined); return joinable.answer; }
    const mine = {generation};
    mine.answer = Promise.resolve().then(() => read(...args)).finally(() => { if (running.get(key) === mine) running.delete(key); });
    running.set(key, mine);
    return mine.answer;
  };
}

// A read asked again while the same read runs joins it instead of starting another Python run (7 Oct 2026: ~10 job-list
// reads ran at once, 60 s each, and slowed every other read, Interviews' library to 20-30 s). Reads only: never a write.
export function sharedRead(name, read, {keyOf = () => '', log = () => {}} = {}) {
  const running = new Map();
  return (...args) => {
    const key = String(keyOf(...args) ?? '');
    if (running.has(key)) { log('run', `joined the running ${name} read`, key ? {key} : undefined); return running.get(key); }
    const answer = Promise.resolve().then(() => read(...args)).finally(() => running.delete(key));
    running.set(key, answer);
    return answer;
  };
}

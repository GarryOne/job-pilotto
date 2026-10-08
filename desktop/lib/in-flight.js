// One paid call per question at a time: a second identical ask while the first is still running gets the same answer instead of paying again
// (8 Oct 2026 audit after the live twin: "Localité" sent to Claude twice). Answers are kept by each caller; this only covers the gap until then.
// Used by lib/contact-from-cv.js (forCv) and lib/contact-keys.js (keysFor). Guarded by test/in-flight.test.js.
export function inFlight() {
  const running = new Map();
  return (key, call) => {
    if (running.has(key)) return running.get(key);
    const answer = Promise.resolve().then(call).finally(() => running.delete(key));
    running.set(key, answer);
    return answer;
  };
}

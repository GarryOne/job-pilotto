// One check, shared: callers asking at the same time (or within `ttl` ms) get the same answer instead of each starting
// its own. Settings' overview and the Gmail card once asked at once; one Python check failed and the page showed
// both "Not connected" and "Connected as …". A failed check is not kept, so the next ask tries again.
export function sharedCheck(check, ttl = 30000, now = () => Date.now()) {
  let pending = null, value = null, at = 0;
  const ask = () => {
    if (value && now() - at < ttl) return Promise.resolve(value);
    if (!pending) {
      pending = Promise.resolve().then(check).then(result => {
        if (result?.ok !== false && result?.error === undefined) { value = result; at = now(); }
        return result;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
  ask.forget = () => { value = null; at = 0; };   // the answer changed here (a sign-in or a sign-out): the next ask checks again
  return ask;
}

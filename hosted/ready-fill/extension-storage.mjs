// Writes to a freshly loaded extension's storage through its service worker, after waiting for chrome.storage to exist: a worker evaluated the
// moment it appears has no chrome.storage yet (18 Oct 2026: every Ready to send night failed on it in the Cloudflare container, 3 of 3 locally).
// Used by the night (night.mjs) and the e2e harness (desktop/e2e/lib/real-extension.mjs, pool-eligibility.mjs). Guard: desktop/test/ready-fill.test.js.
export const STORAGE_WAIT_MS = 10000;

// worker: a Playwright Worker (or anything with evaluate(fn, arg)). -> resolves once the values are written; throws when storage never appears.
export function setExtensionStorage(worker, values, waitMs = STORAGE_WAIT_MS) {
  return worker.evaluate(async ({values, waitMs}) => {
    for (const end = Date.now() + waitMs; !globalThis.chrome?.storage?.local && Date.now() < end;) await new Promise(resolve => setTimeout(resolve, 50));
    if (!globalThis.chrome?.storage?.local) throw new Error(`the extension's storage did not appear within ${waitMs} ms`);
    await globalThis.chrome.storage.local.set(values);
  }, {values, waitMs});
}

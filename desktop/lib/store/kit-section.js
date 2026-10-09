// The kit section of a job and how its kit is read from it, on every store: no imports, so a test or a tool can use it without loading the app
// (desktop/e2e test/installed-only.test.mjs). Re-exported by lib/store/extension-store.js. Guarded by test/extension-store.test.js.
export const KIT_SECTION = '📝 Application kit';   // src/stores base.KIT_SECTION: the section the kit is kept in, on every store
// The kit's JSON in its section (base.kit_from): the readable kit, then '### Machine-readable kit' and the kit as a ```json fence. The LAST
// ```json fence is the kit (the whole fence body); null if there is none or it is not JSON.
export function kitOf(markdown) {
  // A fence opens on a line that is exactly ```json (trailing spaces allowed) and closes on a ``` line; the kit is a JSON object.
  const fences = [...String(markdown || '').matchAll(/^```json[ \t]*\n([\s\S]*?)\n```[ \t]*$/gm)];
  let kit = null;
  try { kit = fences.length ? JSON.parse(fences.at(-1)[1]) : null; } catch { return null; }
  return kit && typeof kit === 'object' && !Array.isArray(kit) ? kit : null;
}

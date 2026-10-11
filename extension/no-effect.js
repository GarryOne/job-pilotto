// Remembers which control a press left unchanged (no navigation, no new fields), per tab and page, so no route presses it again and the AI is told "pressed, no effect" on a re-ask.
// Owns: the memory and the same-control test only; the callers are fill-flow.js (notes it, sends it) and apply-press.js (the floor). Guard: desktop/test/no-effect.test.js.
const dead = new Map();   // `${tab id} ${page}` -> the labels (as pressed, 40 characters) of controls whose press changed nothing
export const sameControl = (a, b) => { const norm = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40); return !!norm(a) && norm(a) === norm(b); };
export function noteNoEffect(key, label) {
  const text = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!text) return;
  const kept = dead.get(key) || [];
  if (!kept.some(item => sameControl(item, text))) dead.set(key, [...kept, text].slice(-5));
}
export const noEffectOf = key => [...(dead.get(key) || [])];
export const forgetNoEffect = tabId => { for (const key of [...dead.keys()]) if (key.startsWith(`${tabId} `)) dead.delete(key); };

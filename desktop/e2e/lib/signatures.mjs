// Harness signatures that learn (5 Oct 2026). lib/prejudge.mjs knows a few test mistakes by their error text (a page closed under the step, a planted bug leaking). A mistake that closes
// as `resolution:fp:harness` three times has a signature of its own: its normalised error text. It is added to the list the producer reads (one pinned issue, kept like the noise
// register), so the next run drops it without a model and without a code change. Safe by construction: a signature only decides what is NOT filed; it is revoked the moment an issue with
// the same text closes as a real fix; it is made only from the loop's own text, never from anything a server sends. Pure.
import {resolutionOf} from './resolution.mjs';

export const SIGNATURE_LABEL = 'harness-signatures';
export const MIN_CLOSURES = 3, MAX_SIGNATURES = 50, MAX_PATTERN = 240;

const section = body => /### What was found\n([\s\S]*?)(?:\n### |\n<!--|$)/.exec(String(body || ''))?.[1] || '';
// The error text without what changes from run to run: quoted names and selectors, numbers, long ids.
export function normalizeDetail(text) {
  return String(text || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '·').replace(/https?:\/\/\S+/g, '·').replace(/\b[0-9a-f]{7,}\b/g, '·')
    .replace(/\d+/g, '#').replace(/[^a-z#·:.\s-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90).trim();
}
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A number in the key is a number, or the # it was written as when a text is normalised before it is matched.
export function patternOf(key) { return escape(key).replace(/·/g, '.{0,120}').replace(/#/g, '[\\d#]+').replace(/\s+/g, '\\s+'); }
const idOf = key => { let hash = 5381; for (const char of key) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0; return hash.toString(16).padStart(8, '0'); };

// current: [{id, re, flags, why, issues, learned}] -> {all, added, revoked}
export function learnSignatures(issues = [], current = [], {min = MIN_CLOSURES, now = new Date().toISOString().slice(0, 10)} = {}) {
  const harness = new Map(), real = new Set();
  for (const issue of issues) {
    const resolution = resolutionOf(issue);
    if (resolution !== 'fp:harness' && resolution !== 'fixed') continue;
    const key = normalizeDetail(section(issue.body));
    if (key.length < 12) continue;
    if (resolution === 'fixed') real.add(key); else (harness.get(key) || harness.set(key, []).get(key)).push(issue.number);
  }
  const keep = [], revoked = [];
  for (const signature of current) {   // a signature whose text a real fix has since closed is wrong: gone
    const hit = [...real].some(key => { try { return new RegExp(signature.re, signature.flags || 'i').test(key); } catch { return false; } });
    if (hit) revoked.push(signature.id); else keep.push(signature);
  }
  const added = [];
  for (const [key, numbers] of harness) {
    const id = idOf(key);
    if (numbers.length < min || real.has(key) || keep.some(item => item.id === id)) continue;
    const re = patternOf(key);
    if (re.length > MAX_PATTERN) continue;
    try { new RegExp(re, 'i'); } catch { continue; }
    added.push({id, re, flags: 'i', why: `learned: ${numbers.length} issues closed as a test mistake (${numbers.slice(0, 4).map(n => `#${n}`).join(', ')}) with this error text: "${key}"`, issues: numbers.slice(0, 8), learned: now});
  }
  return {all: [...keep, ...added].slice(-MAX_SIGNATURES), added, revoked};
}

// A finding's text against the learned signatures -> the first that matches, or null.
export function matchLearned(finding, learned = []) {
  const detail = normalizeDetail(finding.detail || '');
  const whole = normalizeDetail(`${finding.title || ''} ${finding.detail || ''}`);
  for (const signature of learned) {
    try { const pattern = new RegExp(signature.re, signature.flags || 'i'); if (pattern.test(detail) || pattern.test(whole)) return signature; } catch { /* a broken entry is ignored */ }
  }
  return null;
}

// The pinned issue that keeps the list, as JSON in its body (the noise register's own pattern).
const BLOCK = /```json\n([\s\S]*?)\n```/;
export function signaturesFromBody(body) { try { const list = JSON.parse(BLOCK.exec(String(body || ''))?.[1] || '[]'); return Array.isArray(list) ? list.filter(item => item && typeof item.re === 'string' && item.re.length <= MAX_PATTERN) : []; } catch { return []; } }
export function signaturesBody(list) {
  const rows = list.slice(-15).reverse().map(item => `| ${item.learned} | \`${item.id}\` | ${String(item.why).replace(/\|/g, '/').slice(0, 150)} |`);
  return ['**Test mistakes the Finder learned to drop before filing** (`desktop/e2e/lib/signatures.mjs`). A text that closed as `resolution:fp:harness` three times is dropped without a judgement; one that closes as a real fix is removed. Delete an entry below to unlearn it.', '',
    `${list.length} learned:`, '', '| Learned | Id | Why |', '|---|---|---|', ...rows, '', '<details><summary>The list (read by the loop: keep it valid JSON)</summary>', '', '```json', JSON.stringify(list), '```', '', '</details>'].join('\n');
}

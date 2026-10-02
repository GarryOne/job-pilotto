// How the form reader and the generic operators fared, as reports for the product (docs: Notion "Self-improving form filling").
// Only failures and unreadable controls become events: a control's kind, its structural fingerprint (no text), what went wrong,
// and the site. The site is named only for known job boards; any other site is a short hash, so distinct sites can be counted
// without telling us which employer you apply to. The owner's own installs (JOB_PILOTTO_OWNER) send plain hosts to debug with.
import crypto from 'node:crypto';
import {ATS} from './form-tab.js';

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const siteName = (host, {owner = false} = {}) => {
  const name = clip(host, 80).toLowerCase();
  if (!name) return '';
  return owner || ATS.test(name) ? name : `h:${crypto.createHash('sha256').update(name).digest('hex').slice(0, 10)}`;
};

// {host, items: [{kind, fp, ok, why}]} from the operators -> telemetry events for the failures.
export function fromOperators(payload, options = {}) {
  const site = siteName(payload?.host, options);
  return (Array.isArray(payload?.items) ? payload.items : []).slice(0, 20)
    .filter(item => item && item.ok === false && /^[a-z0-9]{6,16}$/.test(String(item.fp || '')))
    .map(item => ({control: clip(item.kind, 24), fp: item.fp, outcome: 'failed', why: clip(item.why, 80), site}));
}
// New controls the reader could not read at all (lib/misses.js `fresh` ones): {host, items: [{kind, fingerprint}]}.
export function fromMisses(payload, freshPrints, options = {}) {
  const site = siteName(payload?.host, options);
  return (Array.isArray(payload?.items) ? payload.items : []).slice(0, 10)
    .filter(item => item && freshPrints.has(item.fingerprint))
    .map(item => ({control: clip(item.kind, 24), fp: item.fingerprint, outcome: 'missed', why: '', site}));
}

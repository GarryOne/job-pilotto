// "Top cause per shape" for /admin/lab-form-filling's Needs a fix (docs/superpowers/specs/2026-10-10-pool-feeds-learning.md, step 2): the mechanism cause that left the most required
// questions empty in a pool site's cards this week. A pool card's id ends with the first 8 hex of sha256(site name) (desktop/e2e/lib/pool-card.mjs), so a name finds its own
// cards without the card ever carrying the name. The test applicant's gap causes are skipped (site/src/digest-pool.js). Read-only. Guard: site/test/applying-cause.test.js.
import {APPLICANT_GAPS} from './digest-pool.js';

const DAY = 86400000;
export const hashOf = async name => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(name))))].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');

// names: the pool sites' names -> {name: {cause, lost, nights}} for those with a mechanism cause in the site's NEWEST run only (owner, 15 Oct 2026: a cause counted over older nights
// kept Breitling on "no_option" after its fix). A pool card is one per site and day (its id), so the newest run is the card of the newest day: days[name] names it (the row's last run
// day); without it the site's newest card day in the last 7 days. A site whose newest run has no card has no cause.
export async function topCauses(db, names, now = new Date(), days = {}) {
  const since = new Date(now.getTime() - 6 * DAY).toISOString().slice(0, 10);
  const cards = (await db.prepare("SELECT id, day, causes FROM fill_cards WHERE source = 'pool' AND day >= ?").bind(since).all()).results || [];
  const out = {};
  for (const name of names) {
    const suffix = `-${await hashOf(name)}`, all = cards.filter(card => card.id.endsWith(suffix));
    const newest = days[name] || all.map(card => card.day).sort().pop(), mine = all.filter(card => card.day === newest);
    const lost = {}, nights = {};
    for (const card of mine) {
      let causes = {}; try { causes = JSON.parse(card.causes || '{}'); } catch { /* a bad row has no causes */ }
      for (const [cause, n] of Object.entries(causes)) {
        if (APPLICANT_GAPS.includes(cause) || !(n > 0)) continue;
        lost[cause] = (lost[cause] || 0) + n; (nights[cause] ||= new Set()).add(card.day);
      }
    }
    const top = Object.entries(lost).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (top) out[name] = {cause: top[0], lost: top[1], nights: nights[top[0]].size};
  }
  return out;
}

// The digest's pool section (docs/superpowers/specs/2026-10-10-pool-feeds-learning.md): the owner's nightly smoke pool as a second, labelled source of fill cards
// (fill_cards.source = 'pool'). Owns: which pool causes rank, the >= 2 nights rule, and the "seen by users / seen in the pool" pairing. It reads user cards only to show them
// beside a pool weakness and never changes them: no user-facing number comes from here. Guard: site/test/digest-pool.test.js.

// The test applicant's gaps (no profile data, the AI not asked) are not mechanism failures: counted, never ranked.
export const APPLICANT_GAPS = ['no_data', 'ai_declined', 'ai_unsure', 'ai_off', 'ai_error', 'proposed'];
export const MIN_NIGHTS = 2;   // a moody site's one bad night is not a weakness

const json = text => { try { return JSON.parse(text || '{}'); } catch { return {}; } };

// poolCards: this week's pool rows; userCards: this week's user cards (already parsed); area: the digest's cause -> area words.
export function poolSection(poolRows, userCards, area = {}) {
  const cards = poolRows.map(c => ({...c, causes: json(c.causes), kinds: json(c.kinds)}));
  const lostOf = (list, cause) => list.reduce((s, c) => s + (c.causes[cause] || 0), 0);
  const gaps = cards.reduce((s, c) => s + APPLICANT_GAPS.reduce((t, cause) => t + (c.causes[cause] || 0), 0), 0);
  const ranked = [], once = [];
  const boards = [...new Set(cards.map(c => c.board))];
  for (const board of boards) {
    const here = cards.filter(c => c.board === board), seen = userCards.filter(c => c.board === board);
    for (const cause of [...new Set(here.flatMap(c => Object.keys(c.causes)))].filter(cause => !APPLICANT_GAPS.includes(cause))) {
      const hit = here.filter(c => (c.causes[cause] || 0) > 0);
      if (!hit.length) continue;
      const nights = new Set(hit.map(c => c.day)).size, lost = lostOf(hit, cause);
      const users = {forms: seen.filter(c => (c.causes[cause] || 0) > 0).length, lost: lostOf(seen, cause), of: seen.length};
      const item = {id: `pool:${cause}:${board}`, kind: 'pool', cause, board, area: area[cause] || area.other || '', nights, forms: hit.length, lost, impact: nights * lost,
        seenInPool: {nights, forms: hit.length, of: here.length, lost}, seenByUsers: users, poolOnly: users.forms === 0,
        kinds: hit.reduce((out, c) => { for (const [k, v] of Object.entries(c.kinds)) out[k] = (out[k] || 0) + v; return out; }, {}),
        title: `${cause} on ${board}: ${lost} required question${lost === 1 ? '' : 's'} left in the pool on ${nights} night${nights === 1 ? '' : 's'}`};
      (nights >= MIN_NIGHTS ? ranked : once).push(item);
    }
  }
  const byImpact = (a, b) => b.impact - a.impact;
  return {forms: cards.length, applicantGaps: gaps, weaknesses: ranked.sort(byImpact).slice(0, 15), seenOnce: once.sort(byImpact).slice(0, 15),
    notes: [`A pool weakness needs the same board and cause on ${MIN_NIGHTS}+ nights; one night is listed as seen once.`,
      `Applicant gaps (${APPLICANT_GAPS.join(', ')}) are the test applicant's, counted but never ranked.`, 'Pool rows never change a number users see.']};
}

export function poolMarkdown(pool) {
  if (!pool || !pool.forms) return [];
  const lines = ['', '## Pool (the owner\'s nightly smoke, not users)', '', `${pool.forms} pool forms this week · ${pool.applicantGaps} applicant-gap question(s) not ranked`, ''];
  pool.weaknesses.forEach((w, i) => lines.push(`${i + 1}. **${w.title}** · ${w.poolOnly ? '**pool only: no user has hit it yet**' : `users: ${w.seenByUsers.forms} of ${w.seenByUsers.of} forms`} · id \`${w.id}\``));
  if (pool.seenOnce.length) lines.push('', `Seen once (not ranked): ${pool.seenOnce.map(w => `${w.cause} on ${w.board}`).join(', ')}`);
  return lines;
}

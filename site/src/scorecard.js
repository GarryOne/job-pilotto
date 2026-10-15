// The platform scorecard on /admin/lab-form-filling: one row per platform that real use or the pool knows, joining REAL use (its share of the matched jobs, and the real fills the form-filling
// digest reads: forms and the share of required questions filled) with the pool's TESTS (its sites and how many of them reached the form), and ONE fixed verdict saying what to do
// next. Platform names only, no employer and no install. The two pages stay apart; this is the one place their data meet. Guard: test/scorecard.test.js.
import {digest} from './digest.js';
import {platformDemand, PLATFORMS} from './nextsites.js';

export const VERDICTS = ['Not in the pool', 'Weak in both', 'Blind spot', 'Test failing', 'Bot wall', 'Fine'];   // in the order to act on them
const MIN_FORMS = 5;   // fewer real forms than this is no evidence
const GOOD = 0.7;      // a share of required questions filled, or of pool sites that reached the form, that counts as fine
const REACHED = ['form', 'ready'];
const WALLED = 'code/bot';   // a pool run that ended on the site's own bot wall: a "no" we never go past, so the pool cannot test it

// pool: the page's pool rows ({platform, reached}). -> [{platform, verdict, matchShare, forms, filledShare, poolSites, poolReached, installs}], the ones to act on first.
export async function platformScorecard(db, pool, now = new Date(), slow = (key, fn) => fn()) {
  const {rows, total} = await platformDemand(db, now, slow);
  const boards = await slow('boards', async () => (await digest(db, now)).boards).catch(() => []);
  const byAts = Object.fromEntries(PLATFORMS.map(item => [item.platform, item.ats]));
  const names = [...new Set([...rows.map(row => row.platform), ...pool.map(site => site.platform).filter(name => byAts[name])])];
  const cards = Object.fromEntries(boards.map(board => [board.board, board]));
  return names.map(platform => {
    const demand = rows.find(row => row.platform === platform), sites = pool.filter(site => site.platform === platform), ran = sites.filter(site => site.reached);
    const poolReached = ran.length ? ran.filter(site => REACHED.includes(site.reached)).length / ran.length : null;
    const board = cards[byAts[platform]], forms = board?.forms || 0, filled = forms >= MIN_FORMS && board.filledShare != null ? board.filledShare : null;
    const testsFine = poolReached == null || poolReached >= GOOD, realFine = filled == null || filled >= GOOD;
    const walled = ran.length > 0 && ran.every(site => site.reached === WALLED);   // every pool run stopped at the wall: only real users' fills test it
    const verdict = !sites.length ? 'Not in the pool' : !testsFine && !realFine ? 'Weak in both' : !realFine ? 'Blind spot' : !testsFine ? (walled ? 'Bot wall' : 'Test failing') : 'Fine';
    return {platform, verdict, matchShare: demand && demand.hits ? Math.max(1, Math.round((100 * demand.hits) / total)) : 0, forms, filledShare: filled == null ? null : Math.round(100 * filled),
      poolSites: sites.length, poolReached: poolReached == null ? null : Math.round(100 * poolReached), installs: demand?.installs || 0};
  }).sort((a, b) => VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict) || b.matchShare - a.matchShare || b.forms - a.forms || a.platform.localeCompare(b.platform));
}

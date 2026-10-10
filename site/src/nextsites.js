// "Next sites to add" on /admin/applying: first the PLATFORMS (a fixed public list) most matched jobs are on that the pool covers too little, from any number of installs (owner,
// 10 Oct 2026: most of the matches on Workday and no Workday site in the pool comes first, even from one install); then the hosts real users' applications ended on that the smoke pool lacks, from the k >= 3 aggregate only (src/hostuse.js: a host with
// fewer than 3 installs is never listed, no install is ever named). Ranked by installs, then uses; each row says its platform, how many pool sites that platform already has,
// and the countries of the installs that used it (a country with fewer than 3 installs is "other"). Guard: test/nextsites.test.js.
import {nextSites} from './hostuse.js';
import {platformOf} from './platform.js';

const DAYS = 90;
// The employer systems the engine reads (contributions.ats) that are application platforms, by the name the pool table uses; an employer's own site is not one.
const PLATFORM_OF_ATS = {greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', smartrecruiters: 'SmartRecruiters', workable: 'Workable', recruitee: 'Recruitee', personio: 'Personio',
  teamtailor: 'Teamtailor', join: 'Join', workday: 'Workday', umantis: 'Umantis', successfactors: 'SuccessFactors'};

const bare = host => String(host || '').toLowerCase().replace(/^www\./, '');

// Platforms with no site in the pool, or whose share of the matched jobs is 2 points or more above their share of the pool (a smaller gap is noise), biggest gap first. Counts of fixed names only: no employer, no install.
async function platformGaps(db, pool, now) {
  const since = new Date(now.getTime() - DAYS * 86400000).toISOString().slice(0, 10), names = Object.keys(PLATFORM_OF_ATS), marks = names.map(() => '?').join(',');
  const rows = (await db.prepare(`SELECT ats, SUM(COALESCE(hits, 0)) AS hits, COUNT(DISTINCT install) AS installs FROM contributions WHERE day >= ? AND ats IN (${marks}) GROUP BY ats`).bind(since, ...names).all()).results || [];
  const apps = Object.fromEntries(((await db.prepare(`SELECT board, COUNT(*) AS n FROM fill_cards WHERE day >= ? AND board IN (${marks}) GROUP BY board`).bind(since, ...names).all()).results || []).map(row => [row.board, row.n]));
  const total = rows.reduce((sum, row) => sum + (row.hits || 0), 0);
  return rows.map(row => {
    const platform = PLATFORM_OF_ATS[row.ats], poolSites = pool.filter(site => site.platform === platform).length;
    const match = total ? (row.hits || 0) / total : 0, inPool = pool.length ? poolSites / pool.length : 0;
    return {platform, matchShare: row.hits ? Math.max(1, Math.round(100 * match)) : 0, poolShare: Math.round(100 * inPool), poolSites, installs: row.installs, applications: apps[row.ats] || 0, gap: match - inPool, hits: row.hits || 0};
  }).filter(item => item.poolSites === 0 || item.gap >= 0.02).sort((a, b) => b.gap - a.gap || b.hits - a.hits).map(({gap, hits, ...item}) => item);
}

// pool: the page's pool rows ({start, end, platform}). -> {sites: [...all, best first], hidden: {hosts}}; the page shows the top 5 and offers the rest.
export async function nextToAdd(db, pool, now = new Date()) {
  const covered = new Set(pool.flatMap(site => [bare(site.start), bare(site.end)]).filter(Boolean));
  const perPlatform = pool.reduce((out, site) => ((out[site.platform] = (out[site.platform] || 0) + 1), out), {});
  const {sites, hidden} = await nextSites(db, {now, limit: 200});
  return {hidden, platforms: await platformGaps(db, pool, now), sites: sites.filter(site => !covered.has(site.host)).map(site => {
    const platform = platformOf(site.host);
    return {host: site.host, platform, poolSites: platform === 'Custom' ? 0 : perPlatform[platform] || 0, installs: site.installs, uses: site.uses, readyShare: site.uses ? Math.round((100 * site.ready) / site.uses) : 0, countries: site.countries};
  })};
}

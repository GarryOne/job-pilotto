// "Next sites to add" on /admin/applying: the hosts real users' applications ended on that the smoke pool lacks, from the k >= 3 aggregate only (src/hostuse.js: a host with
// fewer than 3 installs is never listed, no install is ever named). Ranked by installs, then uses; each row says its platform, how many pool sites that platform already has,
// and the countries of the installs that used it (a country with fewer than 3 installs is "other"). Guard: test/nextsites.test.js.
import {nextSites} from './hostuse.js';
import {platformOf} from './platform.js';

const bare = host => String(host || '').toLowerCase().replace(/^www\./, '');

// pool: the page's pool rows ({start, end, platform}). -> {sites: [...all, best first], hidden: {hosts}}; the page shows the top 5 and offers the rest.
export async function nextToAdd(db, pool, now = new Date()) {
  const covered = new Set(pool.flatMap(site => [bare(site.start), bare(site.end)]).filter(Boolean));
  const perPlatform = pool.reduce((out, site) => ((out[site.platform] = (out[site.platform] || 0) + 1), out), {});
  const {sites, hidden} = await nextSites(db, {now, limit: 200});
  return {hidden, sites: sites.filter(site => !covered.has(site.host)).map(site => {
    const platform = platformOf(site.host);
    return {host: site.host, platform, poolSites: platform === 'Custom' ? 0 : perPlatform[platform] || 0, installs: site.installs, uses: site.uses, readyShare: site.uses ? Math.round((100 * site.ready) / site.uses) : 0, countries: site.countries};
  })};
}

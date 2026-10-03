// The Strategy page's "your search may be too narrow" card (src/coverage.py says it; desktop/lib/strategy.js addRoles acts on it).
// Pure: the numbers in, the words and chips out. Nothing is shown for a search that catches enough, or after "Not now" for this crawl.
const number = value => Number(value || 0).toLocaleString('en-US');

export function coverageCard(verdict, dismissedAt = '') {
  if (!verdict || !verdict.narrow || !Array.isArray(verdict.suggestions) || !verdict.suggestions.length) return null;
  if (dismissedAt && verdict.at && dismissedAt === verdict.at) return null;
  const percent = Math.max(1, Math.round((verdict.share || 0) * 100));
  return {
    title: verdict.local ? 'Jobs written in other languages slip past your search' : 'Your search may be too narrow',
    text: (verdict.local ? `Your role keywords are in English, but many jobs in your places are titled in German, French or another language. ` : '') +
      `Of ${number(verdict.in_places)} postings in your places, your role keywords catch ${number(verdict.matched)} (${percent}%). ` +
      'These role words appear in titles your keywords miss; adding one makes the next searches look for it:',
    chips: verdict.suggestions.slice(0, 8).map(item => ({
      term: item.term, label: `+ ${item.term} · ${number(item.count)}`,
      // Each new posting is read and scored once (about 1.5 cents): said before the click, because a broad word brings many.
      title: `${number(item.count)} open posting${item.count === 1 ? '' : 's'}${item.examples?.length ? `, e.g. ${item.examples.join('; ')}` : ''}. About $${(Math.round(item.count * 1.5) / 100).toFixed(2)} once to read and score them.`,
    })),
    at: verdict.at || '',
  };
}

// The same card for places (src/coverage.py): roles the keywords already catch, but in places you did not list. Pure like the one above.
export function placesCard(verdict, dismissedAt = '') {
  const places = verdict?.places;
  if (!places || !Array.isArray(places.options) || !places.options.length) return null;
  if (dismissedAt && verdict.at && dismissedAt === verdict.at) return null;
  const extra = places.options.reduce((sum, option) => sum + (option.count || 0), 0);
  const elsewhere = places.elsewhere ? ` ${number(places.elsewhere)} more are in places that need a visa (US, Asia), so they are left out.` : '';
  return {
    title: 'Matching roles sit just outside your places',
    text: `Your role keywords match ${number(places.title_hits)} open roles; ${number(places.matched)} are in your places. ${number(extra)} more are in these places:` + elsewhere,
    chips: places.options.slice(0, 8).map(option => ({
      place: option.place, label: `+ ${option.place} · ${number(option.count)}`,
      title: `${number(option.count)} open role${option.count === 1 ? '' : 's'}${option.examples?.length ? `, e.g. ${option.examples.join('; ')}` : ''}. About $${(Math.round(option.count * 1.5) / 100).toFixed(2)} once to read and score them.`,
    })),
    at: verdict.at || '',
  };
}

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

// "Your filters drop jobs" (src/coverage.py): excluded title words and ruled-out languages, each with the jobs it hid; a chip removes it.
export function filtersCard(verdict, dismissedAt = '') {
  const words = Array.isArray(verdict?.excluded) ? verdict.excluded : [], languages = Array.isArray(verdict?.languages) ? verdict.languages : [];
  if (!words.length && !languages.length) return null;
  if (dismissedAt && verdict.at && dismissedAt === verdict.at) return null;
  const sample = item => (item.examples?.length ? `, e.g. ${item.examples.join('; ')}` : '');
  return {
    title: 'Your own filters hide jobs',
    text: 'These jobs match your roles and places, but a filter of yours drops them. Remove a filter to see them in the next searches:',
    chips: [...words.map(item => ({exclude: item.fragment, label: `− "${item.fragment.replace(/\\b/g, '')}" · ${number(item.count)}`,
      title: `${number(item.count)} job${item.count === 1 ? '' : 's'} with this excluded word in the title${sample(item)}`})),
    ...languages.map(item => ({language: item.language, label: `− requires ${item.language} · ${number(item.count)}`,
      title: `${number(item.count)} job${item.count === 1 ? '' : 's'} hidden because they require ${item.language}${sample(item)}`}))],
    at: verdict.at || '',
  };
}

// "More places to find jobs" (src/coverage.py unused_sources): the job sources this install does not use, least effort first, each with what it
// takes (a free key, a paid plan). Shown whatever the coverage: more sources mean more jobs. A chip opens its panel in Settings → Connections.
export function sourcesCard(verdict, dismissedAt = '') {
  const sources = Array.isArray(verdict?.sources) ? verdict.sources : [];
  if (!sources.length || (dismissedAt && verdict.at && dismissedAt === verdict.at)) return null;
  return {
    title: 'More places to find jobs',
    text: 'Job sources you do not use yet, easiest first. Each one adds jobs the others miss:',
    chips: sources.map(source => ({id: source.id, label: `+ ${source.name} · ${source.effort}`, title: `${source.effort}: ${source.gain}`})),
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

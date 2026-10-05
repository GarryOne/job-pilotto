// Why an issue was closed, as one label (5 Oct 2026). Until now the reason lived in a free-text comment and the numbers guessed it back with regular expressions, so a false
// positive could not be counted by its cause, and "what do we fix first" had no data. One label per closed issue, `resolution:<name>`, set where the loop closes it (the verdict
// pass, the fixer, the producer) and by a person's closing note; the stats read the label first. Pure.
export const RESOLUTIONS = {
  fixed: 'A fix landed (a commit or a merged pull request)',
  'not-seen': 'Closed after two clean runs of its page: a fix or a one-off, not a judgement',
  'fp:harness': 'The test was wrong, not the product (a step, a selector, a timing)',
  'fp:detector': 'The detector read the screen wrong (hidden or covered content, a list read as a duplicate, a wrong rule)',
  'fp:probe-race': 'The interaction probe raced the app (pressed while it re-rendered, read the state too early)',
  'fp:unknown': 'A false positive whose cause was not named',
  'by-design': 'Real behaviour, chosen on purpose',
  'stale-sighting': 'Seen on a build older than the fix that already closed it',
  duplicate: 'The same cause as another issue',
};
export const PREFIX = 'resolution:';
export const labelOf = name => `${PREFIX}${name}`;
export const isResolution = name => Object.hasOwn(RESOLUTIONS, name);

// The resolution an issue carries, or ''.
export function resolutionOf(issue) {
  for (const item of issue.labels || []) {
    const name = String(item.name || item);
    if (name.startsWith(PREFIX) && isResolution(name.slice(PREFIX.length))) return name.slice(PREFIX.length);
  }
  return '';
}

// A verdict (`false-positive` or `harness`, with an optional "Cause: …" line) -> the resolution name. The cause words the verdict pass is asked for: detector, probe-race, by-design, stale, duplicate.
const CAUSES = {detector: 'fp:detector', 'probe-race': 'fp:probe-race', race: 'fp:probe-race', 'by-design': 'by-design', stale: 'stale-sighting', duplicate: 'duplicate', harness: 'fp:harness'};
export function resolutionForVerdict(word, cause = '') {
  if (word === 'harness') return 'fp:harness';
  if (word !== 'false-positive') return '';
  return CAUSES[String(cause || '').trim().toLowerCase()] || 'fp:unknown';
}

// Put the label on an issue (creating it once). `gh` is the injected runner of triage.
export function setResolution(gh, number, name) {
  if (!isResolution(name)) return false;
  gh(['label', 'create', labelOf(name), '--force', '--color', name.startsWith('fp:') ? 'F9D0C4' : name === 'fixed' ? '0E8A16' : 'C5DEF5', '--description', RESOLUTIONS[name].slice(0, 90)]);
  gh(['issue', 'edit', String(number), '--add-label', labelOf(name)]);
  return true;
}

// How many closed issues carry each resolution -> {name: count}; the page shows what closes the loop's issues, and why the false ones were false.
export function resolutionCounts(issues) {
  const counts = {};
  for (const issue of issues) { const name = resolutionOf(issue); if (name) counts[name] = (counts[name] || 0) + 1; }
  return counts;
}

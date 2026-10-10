// Statistics count only what the Finder filed AFTER its last big recalibration (the "a UI problem is real when it costs the person something" rules, 4 Oct 2026; moved to 9 Oct 2026 by the owner: a bug in the stats had skewed the numbers since):
// earlier findings were filed under rules that made much more noise, so they would skew precision, flake rate and the noise breaker. The issues stay on GitHub;
// they are only left out of the numbers. After the next recalibration, move this date forward.
export const STATS_SINCE = '2026-10-09T00:00:00Z';
export const afterEpoch = issue => !issue.createdAt || Date.parse(issue.createdAt) >= Date.parse(STATS_SINCE);

// A circuit breaker per detector (5 Oct 2026). The resolution labels say, for every closed issue, whether its detector was right; so a detector that was wrong in four of its last ten
// outcomes can be treated as what it has become: unproven. Its new findings then go to the verdict pass before an issue is opened (lib/prejudge.mjs), exactly like a one-off AI reading,
// until its recent record recovers. Nothing is switched off and no one is asked: the window slides, so a detector that gets better earns its direct filing back. Unlike the AI-review
// noise breaker (lib/plan.mjs, which pauses a costly review for good), this one costs one judgement per finding and heals itself. Pure.
import {STATS_SINCE} from './stats-epoch.mjs';
import {classify, detectorOf} from './selfheal-stats.mjs';

export const BREAKER = {window: 10, min: 6, share: 0.4};
const WRONG = new Set(['falsePositive', 'harness']);   // the detector was wrong (a test mistake counts: its step was a detector too)
const RIGHT = new Set(['fixed', 'queued']);            // the detector was right (a duplicate, a stale sighting, an unclear one say nothing about it)

// -> {detector: {judged, wrong, rate, tripped}}: over each detector's most recent `window` outcomes since the cutoff.
export function breakerState(issues = [], {window = BREAKER.window, min = BREAKER.min, share = BREAKER.share, since = STATS_SINCE} = {}) {
  const by = {};
  for (const issue of issues) {
    if (!(String(issue.createdAt || '') >= since)) continue;
    const kind = classify(issue);
    if (!WRONG.has(kind) && !RIGHT.has(kind)) continue;
    (by[detectorOf(issue)] ??= []).push({at: String(issue.createdAt || ''), wrong: WRONG.has(kind)});
  }
  const out = {};
  for (const [detector, rows] of Object.entries(by)) {
    const recent = rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, window);
    const wrong = recent.filter(row => row.wrong).length;
    out[detector] = {judged: recent.length, wrong, rate: recent.length ? Math.round(100 * wrong / recent.length) : null, tripped: recent.length >= min && wrong / recent.length >= share};
  }
  return out;
}

// The detector names whose findings need a judgement before filing.
export const trippedSources = state => new Set(Object.entries(state || {}).filter(([, row]) => row.tripped).map(([name]) => name));

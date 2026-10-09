// Reports (pages/reports.js), pure: the weekly reports in full, the insight history with its feedback, and the funnel's table, from the
// store's 💡 Insights records and Focus's funnel. The bodies are the engine's Markdown (src/ai/insights_text.weekly_blocks,
// src/ai/learning.publish), read as groups by job-page-view.js groupsOf (one reader). Guarded by test/reports-view.test.js.
import {shortDay} from './date.js';
import {groupsOf, plain} from './job-page-view.js';

export const WEEKLY = 'Weekly report';            // src/ai/insights.py WEEKLY
const APART = new Set([WEEKLY, 'Interview patterns']);   // interview patterns have their own card (renderer/interview-insight.js)
const newest = (a, b) => String(b.day || '').localeCompare(String(a.day || '')) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
const lines = value => String(value || '').split('\n').map(line => plain(line.replace(/^\s*[-*•]\s+/, ''))).filter(Boolean);

// Newest first; a day with several (re-runs) keeps its newest.
export function weeklyReports(insights = []) {
  const seen = new Set();
  return insights.filter(row => row.category === WEEKLY).sort(newest).filter(row => !seen.has(row.day) && seen.add(row.day))
    .map(row => ({id: row.id, day: row.day, title: plain(row.title), confidence: row.fields?.confidence || '', groups: groupsOf(row.body)}));
}

// A weekly report (weeklyReports) as the card Recent activity draws (pages/activity-cards.js weeklyCard: headline, finding,
// summary, focus, what worked, change next week) and the report's other sections under it (priorities with their evidence,
// numbers, daily insights), in src/ai/insights_text.py weekly_blocks' order. A line ending in a link keeps it: {text, url}.
const CARD_PARTS = {'What worked': 'worked', 'Change next week': 'change', 'Focus': 'focus'};
const TRAILING_URL = /^(.*?)(?:\s*·\s*)?(https?:\/\/\S+)$/;
const textOf = line => line?.text ?? line?.fold ?? String(line ?? '');
export function linked(line) {
  const text = textOf(line), found = TRAILING_URL.exec(text);
  return found ? {text: found[1].trim(), url: found[2]} : {text};
}
export function weeklyCardOf(week) {
  const weekly = {headline: week.title, finding: '', summary: '', worked: [], change: [], focus: ''};
  const extra = [];
  for (const part of week.groups || []) {
    const lines = (part.lines || []).map(textOf).filter(Boolean);
    if (!part.title) {   // the head: the callout (the week's finding) and the summary
      const callout = (part.lines || []).find(line => line?.quote);
      weekly.finding = callout ? textOf(callout) : '';
      weekly.summary = (part.lines || []).filter(line => line !== callout).map(textOf).filter(Boolean).join(' ');
    } else if (CARD_PARTS[part.title] === 'focus') weekly.focus = lines.join(' ');
    else if (CARD_PARTS[part.title]) weekly[CARD_PARTS[part.title]] = lines;
    else extra.push({title: part.title, lines: (part.lines || []).map(linked).filter(line => line.text || line.url)});
  }
  return {weekly, extra};
}

// The daily and process insights, newest first: {id, day, category, title, evidence, action, confidence, feedback, groups}.
export function insightItems(insights = []) {
  return insights.filter(row => !APART.has(row.category)).sort(newest).map(row => ({
    id: row.id, day: row.day, category: row.category || '', title: plain(row.title), evidence: lines(row.fields?.evidence),
    action: plain(row.fields?.action || ''), confidence: row.fields?.confidence || '', feedback: row.fields?.feedback || '',
    // A process issue's page: its action, the "Supported hypothesis" gate and each source's quote (src/ai/learning.py publish).
    groups: groupsOf(row.body)}));
}

const pct = value => (value == null || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`);
// The Pipeline page's table (src/notion/funnel.py blocks): Step, Reached, From previous (with the counts), Of applied, Still open here.
export function funnelRows(funnel = {}) {
  const steps = funnel?.steps || [];
  return steps.map((step, i) => {
    const previous = steps[i - 1];
    // The engine's from/conversion when it sends them (src/focus_state.py funnel), else the same share from the counts.
    const from = step.from ?? previous?.reached, share = step.conversion !== undefined ? step.conversion : from ? step.reached / from : null;
    return {step: step.step, reached: step.reached ?? 0,
      fromPrevious: previous ? `${pct(share)}  (${step.reached}/${from ?? 0})` : '—',
      ofApplied: i ? pct(step.of_applied) : '—', open: step.now ?? step.waiting ?? '—'};
  });
}

// "Where to improve": the engine's lines (funnel_steps.summary) when it sends them, else the one step to improve with its advice.
export function improveLines(funnel = {}) {
  if (Array.isArray(funnel?.summary) && funnel.summary.length) return funnel.summary.map(String);
  return funnel?.improve ? [`Improve ${funnel.improve.step}: ${funnel.improve.advice}`] : [];
}

export const dayLabel = day => shortDay(String(day || '').slice(0, 10)) || String(day || '');   // the screens' one format (date.js)

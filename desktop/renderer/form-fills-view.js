// Form-fill history, without a window (pages/form-fills.js draws it): one agent run (src/stores/base.py AGENT_RUN_FIELDS + EXTRAS) as
// the list row and the detail, read from the shapes in the store spec's "Agent run shapes": fields.data = {fields, left_for_you,
// attachments, steps}; fields.timeline = a Claude session's status line. Guarded by test/form-fills-view.test.js.

// Outcome → tone: done good, waiting for you warn, still going info, failed bad, the rest (not submitted, cancelled…) neutral.
const TONES = {Ready: 'good', Submitted: 'good', 'Needs input': 'warn', Open: 'info', Running: 'info', Failed: 'bad', Error: 'bad'};
export const outcomeTone = outcome => TONES[outcome] || 'neutral';

const num = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const data = run => (run?.fields?.data && typeof run.fields.data === 'object' ? run.fields.data : {});

// A session of the coding agent (the Agent column / record ats is its name: lib/session-runs.js AGENT), not an extension fill.
export const isSession = run => /^claude$/i.test(String(run?.fields?.agent || run?.ats || ''));

export function agentOf(run) {
  const agent = String(run?.fields?.agent || run?.ats || '');
  return isSession(run) ? 'Claude session' : /^extension$/i.test(agent) ? 'Extension' : run?.fields?.agent || 'Form fill';
}

// The list row: {title, company, agent, outcome, tone, at, minutes, fields, left}.
export function summary(run) {
  const f = run?.fields || {}, rows = data(run).fields || [];
  const outcome = run?.outcome || f.status || 'Open';
  const count = num(f.field_count) ?? (rows.length || null);
  return {title: f.job || hostOf(run?.url) || 'Form', company: f.company || '', agent: agentOf(run), outcome, tone: outcomeTone(outcome),
    at: f.started || run?.created_at || '', minutes: num(f.minutes), fields: count,
    left: num(f.unfilled_required) ?? rows.filter(row => row.outcome !== 'filled' && row.required).length};
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// The field-by-field table: [{label, required, source, result, note, low}].
export function fieldRows(run) {
  return (data(run).fields || []).map(row => ({label: row.label || '', required: row.required === true ? 'yes' : row.required === false ? '' : '?',
    source: row.source || '—', result: row.outcome === 'filled' ? 'filled' : 'left', note: row.reason || '', low: row.confidence === 'low'}));
}

export const leftForYou = run => (data(run).left_for_you || []).filter(Boolean);
export const attachments = run => (data(run).attachments || []).filter(Boolean);

// Step timings [{step, seconds}] (extension fills), else [] (a Claude session has its timeline line instead).
export const steps = run => (data(run).steps || []).filter(step => step?.step).map(step => ({step: step.step, seconds: Math.round((Number(step.ms) || 0) / 100) / 10}));
// A Claude session's status timeline, as the steps of a walk: ["11:02:00 working", …].
export const timeline = run => String(run?.fields?.timeline || '').split('→').map(part => part.trim()).filter(Boolean);

// The learnings line(s): the record field, split on ' · ' as the extension joins them.
export const learnings = run => String(run?.learnings || '').split(' · ').map(text => text.trim()).filter(Boolean);

// A Claude session's numbers, [label, value] for the ones present.
export function sessionNumbers(run) {
  const f = run?.fields || {};
  const pairs = [['Working', f.working_min, ' min'], ['Waiting for you', f.waiting_min, ' min'], ['Times asked', f.times_asked, ''],
    ['Your reply (median)', f.reply_median_s, ' s'], ['Ready → decided', f.ready_to_decided_min, ' min'], ['Turns', f.turns, ''],
    ['Tool calls', f.tool_calls, '']];
  return [...pairs.filter(([, value]) => num(value) !== null).map(([label, value, unit]) => [label, `${num(value)}${unit}`]),
    ...(f.model ? [['Model', f.model]] : [])];
}

// The detail's meta line: when, how long, billed to, why.
export function metaLine(run, {when = iso => iso} = {}) {
  const s = summary(run), f = run?.fields || {};
  return [s.at && when(s.at), s.minutes !== null && `${s.minutes} min`, s.fields !== null && `${s.fields} fields`, f.billed_to, f.reason]
    .filter(Boolean).join(' · ');
}

// The list's filter: free text over job, company, host, agent and outcome; outcome '' = all.
export function filterRuns(runs, {text = '', outcome = ''} = {}) {
  const needle = text.trim().toLowerCase();
  return (runs || []).filter(run => {
    const s = summary(run);
    return (!outcome || s.outcome === outcome) && (!needle || `${s.title} ${s.company} ${hostOf(run.url)} ${s.agent} ${s.outcome}`.toLowerCase().includes(needle));
  });
}

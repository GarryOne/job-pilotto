// Notion later: what "Notion is connected" means, and the one answer a tracking action gives when it is not.
// Without Notion the app only tries (search, fit scores, Jobs list, Strategy); everything tracked asks to connect.
export const connected = storage => !!storage.secret('NOTION_TOKEN') && !!storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID;

// Completes "Connect Notion …": what the user asked for that needs Notion.
export const REASONS = {
  save: 'to save this job', dismiss: "to hide jobs you don't want", prepare: 'to draft an application kit',
  apply: 'to apply and keep the record', applied: 'to track an application', add: 'to add a job',
  lead: 'to track a recruiter lead', log: 'to log this message', interviews: 'to keep interview transcripts',
  focus: 'to see what to do next', cloud: 'for Always on', telegram: 'for Telegram buttons',
  gmail: 'for Gmail checks', profile: 'to edit your details and answers',
  tune: 'to tune your strategy from your results', kits: 'to draft application kits',
};

// {ok: false, needsNotion: true, reason, text, error}: the window opens the connect dialog on needsNotion (pages/core.js gated()).
export function needs(reason) {
  const text = `Connect Notion ${REASONS[reason]}.`;
  return {ok: false, needsNotion: true, reason, text, error: text};
}

// A job status the Notion Applications stages cover (src/desktop.py NOTION_STAGES) -> the reason; others need no Notion.
export const statusReason = status => ({saved: 'save', dismissed: 'dismiss', applied: 'applied'})[status] || null;

// null when the action may go on (connected, or the demo, which has its own fictional data), else needs(reason).
export const check = (storage, reason, {demo = false} = {}) => (demo || connected(storage) ? null : needs(reason));

// What the prompt may report (opt-in reports, like the setup funnel): fixed lists only, never words or jobs.
// {step: 'notion_gate', reason, where, outcome, why?, minutes, shown} or null for anything not on the lists.
export const WHERE = ['dialog', 'view', 'extras', 'settings'];
export const OUTCOMES = ['connected', 'not_now', 'closed', 'failed', 'viewed'];
export const WHY = ['no_notion', 'privacy', 'later', 'other'];
export function gateEvent(payload, {firstRunAt = null, shown = 0, now = Date.now()} = {}) {
  const {reason, where, outcome, why} = payload || {};
  if (!(Object.hasOwn(REASONS, reason) || reason === 'none') || !WHERE.includes(where) || !OUTCOMES.includes(outcome)) return null;
  const minutes = firstRunAt ? Math.max(0, Math.round((now - Date.parse(firstRunAt)) / 60000)) : null;
  return {step: 'notion_gate', reason, where, outcome, ...(outcome === 'not_now' && WHY.includes(why) ? {why} : {}), minutes, shown: shown + 1};
}

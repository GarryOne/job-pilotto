// Outbound or inbound: did you go after this opportunity, or did it find you? The same rule as src/notion/origin.py,
// both checked against tests/fixtures/opportunity_origin.json. Inbound: a recruiter's pitch (Stage "Recruiter lead",
// a "Recruiter lead" event, Notes "Recruiter message (…)") or a first contact on LinkedIn or by phone (Source).
// Everything else is outbound, "Applied elsewhere" (Notes "Logged from a paste (…)") and an unknown Source included.
export const INBOUND = 'inbound', OUTBOUND = 'outbound';
const LEAD = 'Recruiter lead';
const INBOUND_SOURCES = new Set(['LinkedIn', 'Phone']);
const LEAD_NOTES = 'Recruiter message (', ELSEWHERE_NOTES = 'Logged from a paste (';

export function origin({source = '', stage = '', notes = '', kinds = []} = {}) {
  const note = String(notes || '').trimStart();
  if (stage === LEAD || (kinds || []).includes(LEAD) || note.startsWith(LEAD_NOTES)) return INBOUND;
  if (note.startsWith(ELSEWHERE_NOTES)) return OUTBOUND;
  return INBOUND_SOURCES.has(String(source || '').trim()) ? INBOUND : OUTBOUND;
}
export const isInbound = job => origin(job || {}) === INBOUND;
// Focus → Application funnel: the line under the (outbound) steps. Empty when nothing found you yet.
export function inboundLine(inbound) {
  const {contacted = 0, screening = 0, interviews = 0} = inbound || {};
  return contacted ? `Inbound: ${contacted} contacted you · ${screening} screening · ${interviews} interview${interviews === 1 ? '' : 's'}` : '';
}

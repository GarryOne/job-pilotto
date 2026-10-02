// The wording of a form question the filler could not answer, cleaned for the product's learning (Notion: "Knowledge as data: build plan").
// Only the form's own public wording ("Heimatort", "Notice period") and never anything the user typed: this runs on the question label,
// which comes from the page, and drops what could carry personal data (addresses, long numbers, links). The site keeps a label's text only
// when several installs report it.
const MAX = 100;

// -> the normalised label, or '' when it must not leave this Mac.
export function cleanLabel(label) {
  let text = String(label ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  text = text.replace(/\*+/g, '').replace(/\((optional|required|erforderlich|obligatoire)\)/g, '').replace(/^\s*\d+[.)]\s+/, '').replace(/[\s:;,.?!-]+$/g, '').trim();
  if (text.length < 3 || text.length > MAX) return '';
  if (/@|https?:|www\./.test(text)) return '';           // an address or a link
  if (/\d{4,}/.test(text) || (text.match(/\d/g) || []).length > 3) return '';   // a long number (phone, year-month-day, postcode ...)
  if (/[<>{}\[\]\\|]/.test(text)) return '';              // markup or template text
  if (!/\p{L}{3}/u.test(text)) return '';                  // no real words
  return text;
}

// {trace: [{label, type, required, reason}]} rows of one fill -> [{label, kind, required}] for the questions no answer matched.
export const NO_ANSWER = 'no answer in the kit, Profile or your details';
export function unplaced(trace, max = 20) {
  const out = [], seen = new Set();
  for (const row of Array.isArray(trace) ? trace : []) {
    if (!row || row.reason !== NO_ANSWER || row.type === 'file') continue;
    const label = cleanLabel(row.label);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({label, kind: String(row.type || '').replace(/[^a-z-]/g, '').slice(0, 20), required: !!row.required});
    if (out.length >= max) break;
  }
  return out;
}

// What happened on a page of an application, as one word per board (counted by the site): the extension reports {role, pressed, ok}.
export function flowState(flow) {
  const role = String(flow?.role || '');
  if (role === 'form') return flow.ok === false ? 'fill-error' : 'filled';
  if (role === 'account') return 'account';
  if (role === 'no-form') return flow.pressed ? 'no-form-after-apply' : 'no-form';
  return '';
}

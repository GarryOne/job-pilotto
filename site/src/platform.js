// The pool table's two words, from structure only (no per-site branches): the application platform a host belongs to (the ATS hosts the engine already reads feeds
// from, src/sources/ats.py URL_PATTERNS; anything else is "Custom") and the flow a smoke signature tests, in words (lib/smoke.mjs signature(): page kinds in order
// @ the host the journey ended on # how far it got). Used by src/applying.js. Guard: test/platform.test.js.
const PLATFORMS = [['Workday', /(^|\.)myworkdayjobs\.com$/], ['SuccessFactors', /(^|\.)(successfactors\.(com|eu)|sapsf\.(com|eu))$/], ['Greenhouse', /(^|\.)greenhouse\.io$/],
  ['Ashby', /(^|\.)ashbyhq\.com$/], ['Lever', /(^|\.)lever\.co$/], ['SmartRecruiters', /(^|\.)smartrecruiters\.com$/], ['Workable', /(^|\.)workable\.com$/],
  ['Personio', /(^|\.)personio\.(de|com)$/], ['Recruitee', /(^|\.)recruitee\.com$/], ['Teamtailor', /(^|\.)teamtailor\.com$/], ['Join', /(^|\.)join\.com$/], ['Umantis', /(^|\.)umantis\.com$/]];
export const platformOf = host => PLATFORMS.find(([, pattern]) => pattern.test(String(host || '').toLowerCase()))?.[0] || 'Custom';

// What a signature may look like: fixed words and a host, so no path or query can ride along.
export const SIGNATURE = /^(unclear|[a-z-]+(>[a-z-]+)*@[a-z0-9.-]+#(none|posting|account|code\/bot|form|ready))$/;
export const signatureHost = signature => String(signature || '').match(/@([^#]+)#/)?.[1] || '';

const WORDS = {posting: 'posting', account: 'account', 'account-form': 'account and form on one page', form: 'form', other: 'other page'};
const FORMS = ['form', 'account-form'];

// -> {flow: words | 'unclear' | null (never run), raw}. The AI calls a first page "other" one time and "form" the next: a leading "other" that leads straight to a form
// on the same host (the start host, or the start is unknown) is the same flow, so it is dropped from the words; the raw signature stays for the tooltip.
export function flowOf(signature, startHost = '') {
  const raw = String(signature || '');
  if (!raw) return {flow: null, raw};
  if (raw === 'unclear') return {flow: 'unclear', raw};
  const [path, rest = ''] = raw.split('@'), reached = rest.split('#')[1] || 'none', kinds = path.split('>');
  if (kinds[0] === 'other' && FORMS.includes(kinds[1]) && (!startHost || startHost === signatureHost(raw))) kinds.shift();
  const steps = kinds.map(kind => WORDS[kind] || kind);
  if (steps[0] !== 'posting') steps.unshift('posting');
  if (reached === 'code/bot') steps.push('bot check');
  return {flow: steps.join(' → '), raw};
}

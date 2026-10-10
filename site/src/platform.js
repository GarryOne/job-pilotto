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

// The Platform cell: a known platform by name; a custom site that ends on another company's domain is "Custom (that domain's name)", so one shared
// recruiting system still groups together; otherwise plain "Custom".
const domainName = host => { const parts = String(host).split('.'); const n = parts.length; return n < 2 ? '' : (n > 2 && parts[n - 2].length <= 3 && parts[n - 1].length === 2 ? parts[n - 3] : parts[n - 2]); };
export function platformLabel(end, start) {
  const platform = platformOf(end || start);
  if (platform !== 'Custom' || !end || !start) return platform;
  const a = domainName(end), b = domainName(start);
  return a && a !== b ? `Custom (${a})` : platform;
}

// A discovered site is named "<company> (found 2026-10-10)": the table shows the company. Older ones carry a raw flow signature ("posting>form@x.com (found …)"): those
// show the start host's domain name instead.
export const displayName = (name, startHost) => {
  const found = String(name).match(/^(.*?)\s*\(found \d{4}-\d\d-\d\d\)$/);
  if (!found) return name;
  const word = /[>@#]/.test(found[1]) ? domainName(startHost) : found[1];
  return word ? word[0].toUpperCase() + word.slice(1) : name;
};

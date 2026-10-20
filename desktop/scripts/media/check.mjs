// The product media's checks (desktop/scripts/media): fictional data only, the dark theme, the extension really filled the form. Pure where it can
// be; a failed check stops the run, so no picture with a real address or a broken scene reaches the site. Guard: desktop/test/media-check.test.js.

// E-mail addresses on screen must be on reserved test domains (example.com/.org/.net, .example, .test, .invalid): anything else may be real.
const EMAIL = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;
const RESERVED = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$/i;
export function realEmails(text) {
  return [...new Set([...String(text || '').matchAll(EMAIL)].map(match => match[0]).filter(address => !RESERVED.test(address.split('@')[1])))];
}

// A persona folder may hold only placeholder keys (desktop/demo/secrets.json): a folder with a real token is someone's data, never media.
export function realSecrets(secrets) {
  return Object.entries(secrets || {}).filter(([, value]) => typeof value === 'string' && value.length >= 20 && !/demo|placeholder|example|fake|xxx|0000/i.test(value)).map(([key]) => key);
}

// A persona's screens must not show the default person's words (media.json "forbid"): a leftover means a demo file the persona did not replace.
export const leftWords = (text, words = []) => words.filter(word => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(String(text || '')));

// The fields the extension must have filled on form.html for the clip to show a real fill (the question answers come from the persona).
export const MUST_FILL = ['first_name', 'last_name', 'email', 'resume', 'permit', 'privacy'];
export const missingFills = filled => MUST_FILL.filter(field => !(filled || []).includes(field));

// The app's screens are dark (the site is dark-only): a mean brightness over this is the light theme or a blank window.
export const DARK_MAX = 0.35;

// -> list of problems (empty = fine) for one recorded piece.
export function pieceProblems({name, source, log, posterBrightness, forbid = []}) {
  const problems = [];
  const left = leftWords(log.text, forbid);
  if (left.length) problems.push(`${name}: the default demo person shows through: ${left.join(', ')}`);
  const emails = realEmails(log.text);
  if (emails.length) problems.push(`${name}: an e-mail address that may be real is on screen: ${emails.join(', ')}`);
  if (source === 'app' && posterBrightness > DARK_MAX) problems.push(`${name}: the window is not dark (brightness ${posterBrightness.toFixed(2)})`);
  if (source === 'extension') { const missing = missingFills(log.filled); if (missing.length) problems.push(`${name}: the extension did not fill ${missing.join(', ')}`); }
  const seconds = log.frames.at(-1)?.t || 0;
  if (log.frames.length < seconds * 5) problems.push(`${name}: only ${log.frames.length} frames in ${seconds.toFixed(1)} s (the capture stalled)`);
  return problems;
}

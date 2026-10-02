// Label meanings as DATA: "Heimatort" means the profile field place_of_origin. An alias says that a form question's wording (a short
// phrase) stands for one of the fixed profile fields the extension already fills (page/fill.js PROFILE_LABELS). It adds meanings only: the
// value still comes from the user's profile, the field still goes through the same filler, and consent / legal questions are never
// matched. One source of truth, imported by the site (what it accepts and serves), the app (what it passes on) and the extension's
// tests (the filler in page/fill.js keeps a plain-script copy of aliasKey, checked against this one by a test).
// A phrase on a posting page's button that means "start applying" (tab-pages.js pickApplyButton): the second kind of meaning in this pack.
export const BUTTON_KEYS = ['apply_button'];
export const KEYS = ['first_name', 'last_name', 'full_name', 'email', 'phone', 'linkedin', 'github', 'website', 'location', 'street', 'postal_code', 'place_of_origin', 'birth_date'];
// A wrong meaning for these would put personal data where it does not belong, so they are never rolled out without the owner's approval.
export const SENSITIVE = ['phone', 'street', 'postal_code', 'place_of_origin', 'birth_date'];
// Words a start-applying button never has: sign in, share, save, submit and the like (the same list as NOT_APPLY in tab-pages.js).
const NOT_APPLY = /sign.?in|log.?in|register|create (an )?account|submit|send|save|share|alert|easy apply|apply with |already applied|follow|subscribe|cookie|accept|decline|reject|password|search|filter|menu|language/i;
const FORBIDDEN = /\b(i agree|i accept|terms|privacy|consent|acknowledg|certif|affirm|password|passwort|signature|sign here|captcha|submit|apply now|salary|gehalt|visa|permit|gender|disability|race|ethnic|religion)\b/i;

// The same cleaning the app and the site apply to a question's wording: lower case, no stars or "(optional)", no personal-looking text.
export function cleanLabel(label) {
  let text = String(label ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  text = text.replace(/\*+/g, '').replace(/\((optional|required|erforderlich|obligatoire)\)/g, '').replace(/^\s*\d+[.)]\s+/, '').replace(/[\s:;,.?!-]+$/g, '').trim();
  if (text.length < 3 || text.length > 100) return '';
  if (/^[a-z]+([-_ ][a-z]+)?[-_ ]\d+$/.test(text)) return '';   // a generated field id ("radio-999", "menu-940"), not a question
  if (/@|https?:|www\./.test(text) || /\d{4,}/.test(text) || (text.match(/\d/g) || []).length > 3 || /[<>{}\[\]\\|]/.test(text) || !/\p{L}{3}/u.test(text)) return '';
  return text;
}

const fail = error => ({ok: false, error});

// -> {ok: true, alias: {key, phrase}} or {ok: false, error}.
export function validateAlias(input) {
  if (!input || typeof input !== 'object') return fail('not an object');
  if (!KEYS.includes(input.key) && !BUTTON_KEYS.includes(input.key)) return fail('unknown field');
  const phrase = cleanLabel(input.phrase);
  if (!phrase || phrase.length > 60) return fail('bad phrase');
  if (!/^[\p{L}\p{M}0-9 '’/&()-]+$/u.test(phrase)) return fail('bad characters');
  if (/\d/.test(phrase)) return fail('no digits in a meaning');
  if (BUTTON_KEYS.includes(input.key)) {
    if (phrase.length > 40 || phrase.split(' ').length > 5) return fail('too long for a button');
    if (NOT_APPLY.test(phrase)) return fail('not a start-applying button');
    return {ok: true, alias: {key: input.key, phrase}};
  }
  if (FORBIDDEN.test(phrase)) return fail('not a profile question');
  return {ok: true, alias: {key: input.key, phrase}};
}

// A list of aliases: the valid ones, once each, at most `max`.
export function validateBundle(list, max = 2000) {
  const seen = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const result = validateAlias(item);
    if (!result.ok) continue;
    const id = `${result.alias.key}|${result.alias.phrase}`;
    if (!seen.has(id)) seen.set(id, {...result.alias, ...(item.rollout !== undefined ? {rollout: Math.max(0, Math.min(100, Math.round(Number(item.rollout)) || 0))} : {})});
  }
  return [...seen.values()].slice(0, max);
}

// The profile field a question's wording stands for, or ''. The phrase must be the whole wording or stand on word boundaries in it;
// the first alias that fits wins. aliases: [{key, phrase}].
export function aliasKey(label, aliases) {
  const text = cleanLabel(label);
  if (!text) return '';
  for (const item of Array.isArray(aliases) ? aliases : []) {
    if (!item || !KEYS.includes(item.key) || !item.phrase) continue;
    if (text === item.phrase || ` ${text} `.includes(` ${item.phrase} `)) return item.key;
  }
  return '';
}

// Which of the 100 buckets an install falls in is bucketOf in recipe-schema.js: an alias at rollout N applies where bucket < N.

// Whether a button's text is one of the service's start-applying phrases: the whole text, cleaned the same way. aliases: [{key, phrase}].
export function buttonPhrase(text, aliases) {
  const clean = cleanLabel(text);
  if (!clean) return '';
  return (Array.isArray(aliases) ? aliases : []).find(item => item && item.key === 'apply_button' && item.phrase === clean)?.phrase || '';
}

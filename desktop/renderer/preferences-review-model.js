// "Review your preferences" (owner, 17 Oct 2026): the AI's reading of the Preferences fields (lib/preferences-parse.js: countries as ISO codes, cities,
// languages with a CEFR level, relocation, roles, seniority, employment) turned into the clean text each control already stores, and compared with
// what the page holds now. A field is proposed only when the AI flagged its stored text as unparsed (sentences, "or", "plus", "?", dates…) or the
// page has nothing there yet; a clean field is never touched. Nothing is written here: pages/preferences-review.js writes on the person's click.
// Also the Workload rule: its field and value stay in the Profile, but the control shows only for people whose countries include CH, DE or AT.
// No DOM: guarded by test/preferences-review-model.test.js.
import {chipsOf, languagesText, modesOf, modesText} from './preferences-model.js';

export const WORKLOAD_COUNTRIES = ['CH', 'DE', 'AT'];
const names = new Intl.DisplayNames(['en'], {type: 'region'});
export const countryName = code => { try { const name = names.of(code); return name && name !== code ? name : ''; } catch { return ''; } };

export const LEVEL_TEXT = {native: 'Native', C2: 'Fluent', C1: 'Advanced (C1)', B2: 'Upper intermediate (B2)', B1: 'Intermediate (B1)', A2: 'Basic (A2)', A1: 'Beginner (A1)'};
const SENIORITY_TEXT = {junior: 'Junior', mid: 'Mid-level', senior: 'Senior', staff: 'Staff or higher'};
const EMPLOYMENT_TEXT = {permanent: 'Permanent', contract: 'Contract', freelance: 'Freelance', internship: 'Internship', part_time: 'Part-time'};

// The proposed text of each field the AI answer covers; '' when it has nothing for it.
export function proposedTexts(parse, current = {}) {
  const out = {};
  const countries = (parse.countries || []).map(countryName).filter(Boolean);
  out.countries = countries.join(', ');
  const several = new Set((parse.cities || []).map(city => city.country).filter(Boolean)).size > 1;
  out.cities = (parse.cities || []).map(city => (several && city.country && countryName(city.country) ? `${city.name} (${countryName(city.country)})` : city.name)).join(', ');
  out.mode = parse.remote === 'yes' ? modesText([...new Set([...modesOf(current.mode), 'Remote'])]) : '';
  out.languages = languagesText((parse.languages || []).map(each => ({name: each.name, level: LEVEL_TEXT[each.level] || ''})));
  const relocation = parse.relocation || {};
  out.relocation = relocation.answer === 'unknown' || !relocation.answer ? ''
    : `${{yes: 'Yes', no: 'No', maybe: 'Maybe'}[relocation.answer]}${relocation.where ? ` (${relocation.where})` : ''}`;
  out.roles = [...(parse.roles || [])].sort((a, b) => (a.certainty === 'sure' ? 0 : 1) - (b.certainty === 'sure' ? 0 : 1)).map(role => role.title).join(', ');
  out.seniority = SENIORITY_TEXT[parse.seniority] || '';
  const kinds = [...new Set(parse.employment || [])];
  out.employment = !kinds.length ? '' : kinds.length === 1 && kinds[0] === 'permanent' ? 'Permanent only' : kinds.length === 1 && kinds[0] === 'contract' ? 'Contract only'
    : kinds.length === 2 && kinds.includes('permanent') && kinds.includes('contract') ? 'Permanent or contract' : kinds.map(kind => EMPLOYMENT_TEXT[kind]).join(', ');
  return out;
}

const same = (a, b) => String(a).replace(/\s+/g, ' ').trim().toLowerCase() === String(b).replace(/\s+/g, ' ').trim().toLowerCase();

// fields: readProfile(...).fields (key → item | null); parse: the validated answer. → [{key, old, proposed}] in the page's order.
export function reviewOf(fields, parse, order) {
  if (!parse) return [];
  const flagged = new Set(parse.unparsed || []);
  const proposed = proposedTexts(parse, {mode: fields.mode?.value || ''});
  return order.flatMap(key => {
    const text = proposed[key], old = fields[key]?.value || '';
    if (!text || same(text, old)) return [];
    if (old && !flagged.has(key)) return [];   // a clean field stays as the person wrote it
    return [{key, old, proposed: text}];
  });
}

// The country codes the Workload rule can know: the cached AI answer's codes, else the chips read against the ISO region names. null = not sure.
export function countryCodes(text, known = []) {
  const chips = chipsOf(text).map(chip => chip.replace(/\s*\(.*?\)\s*/g, '').trim()).filter(Boolean);
  if (!chips.length) return known.length ? known : null;
  const byName = new Map(); for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { const name = countryName(a + b); if (name) byName.set(name.toLowerCase(), a + b); }
  const codes = chips.map(chip => byName.get(chip.toLowerCase()) || (/^[A-Za-z]{2}$/.test(chip) && countryName(chip.toUpperCase()) ? chip.toUpperCase() : ''));
  return codes.every(Boolean) ? codes : (known.length ? known : null);
}
// Hidden only when the countries are known and none is CH, DE or AT; unknown → shown (a hidden field the person needs is worse than a visible one).
export const showWorkload = (countriesText, known = []) => {
  const codes = countryCodes(countriesText, known);
  return !codes || codes.some(code => WORKLOAD_COUNTRIES.includes(code));
};

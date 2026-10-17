// A question's kind of answer (owner, 17 Oct 2026: "'Accept GDPR consent' cannot be answered in a text field ... if they require dropdown/selectbox,
// then show it properly"): text, long text, pick one, pick several or yes/no, and the form's own options. Read from the fill's field type (structure,
// never words), kept in the store as a mark at the end of the question's line ("Title: ❓ (asked by Adnovum) [pick one: Mr | Mrs | Ms]"), the same text
// on every adapter. Spec docs/superpowers/specs/2026-10-17-base-facts.md. Pure (no DOM): guarded by test/question-kind.test.js.
import {countryNames} from './countries.js';

export const KINDS = ['text', 'long_text', 'single', 'multi', 'yes_no'];
const WORDS = {long_text: 'long text', single: 'pick one', multi: 'pick several', yes_no: 'yes/no'};
const KIND_OF_WORD = Object.fromEntries(Object.entries(WORDS).map(([kind, word]) => [word, kind]));
export const YES_NO = ['Yes', 'No'];
// A short list rides in the store; a long menu (a country list) is kept on this Mac (lib/question-formats.js), rebuilt by the next fill.
export const STORED_OPTIONS = 8, STORED_CHARS = 160;
const MAX_OPTIONS = 60;
const COUNTRY = 'pick a country';   // a single choice among the countries (renderer/countries.js), however the form named them
const MARK = /\s*\[(long text|pick one|pick several|yes\/no|pick a country)(?::\s*([^\]]*))?\]\s*$/;

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
export function cleanOptions(options) {
  const seen = new Set(), out = [];
  for (const option of Array.isArray(options) ? options : []) {
    const text = clean(typeof option === 'object' && option ? option.text ?? option.label : option).slice(0, 120);
    if (text && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); out.push(text); }
  }
  return out.slice(0, MAX_OPTIONS);
}

// A fill's field ({type, options, multiple}, extension/page/fill-read.js) -> {kind, options}. A lone checkbox is a yes/no.
export function formatOfField({type = '', options = [], multiple = false} = {}) {
  const t = String(type).toLowerCase();
  if (t === 'textarea') return {kind: 'long_text', options: []};
  if (t === 'checkbox') return {kind: 'yes_no', options: []};
  if (t === 'checkbox-group') return {kind: 'multi', options: cleanOptions(options)};
  if (t === 'select' || t === 'radio' || t === 'combobox') return {kind: multiple ? 'multi' : 'single', options: cleanOptions(options)};
  return {kind: 'text', options: []};
}

// {kind, options} -> the mark the store keeps ('' for a text question). Options go in only when the list is short and none holds a | or ].
export function markOf({kind = 'text', options = [], list = ''} = {}) {
  if (!WORDS[kind]) return '';
  if (kind === 'single' && list === 'countries') return `[${COUNTRY}]`;
  const picks = kind === 'yes_no' ? [] : cleanOptions(options);
  const joined = picks.join(' | ');
  const fits = picks.length && picks.length <= STORED_OPTIONS && joined.length <= STORED_CHARS && !picks.some(option => /[|\]]/.test(option));
  return `[${WORDS[kind]}${fits ? `: ${joined}` : ''}]`;
}

// "Title: Mr [pick one: Mr | Mrs]" -> {text: 'Title: Mr', kind: 'single', options: ['Mr', 'Mrs'], marked: true}; no mark -> {text, kind: '', options: [], marked: false}.
export function splitMark(text) {
  const raw = String(text ?? '');
  const match = raw.match(MARK);
  if (!match) return {text: raw, kind: '', options: [], marked: false};
  if (match[1] === COUNTRY) return {text: raw.slice(0, match.index), kind: 'single', list: 'countries', options: [], marked: true};
  const kind = KIND_OF_WORD[match[1]];
  return {text: raw.slice(0, match.index), kind, options: kind === 'yes_no' ? [] : cleanOptions((match[2] || '').split('|')), marked: true};
}

// The text with its mark set to this format (a text format removes the mark).
export function withMark(text, format) {
  const mark = markOf(format || {});
  const bare = splitMark(text).text.replace(/\s+$/, '');
  return mark ? `${bare} ${mark}` : bare;
}

// Which format a row is answered with: the store's mark first, then what this Mac kept (the last fill's, else the AI's judgment), else text.
// A yes/no always offers Yes and No; a choice with no known options is answered as text (its kind is kept).
export function formatFor({marked = null, kept = null, locale = 'en'} = {}) {
  const from = marked?.kind ? marked : kept?.kind ? kept : {kind: 'text', options: []};
  const kind = KINDS.includes(from.kind) ? from.kind : 'text';
  const list = kind === 'single' && (from.list || (kept?.kind === kind && kept.list)) === 'countries' ? 'countries' : '';
  const options = kind === 'yes_no' ? YES_NO : list ? countryNames(locale) : cleanOptions(from.options?.length ? from.options : kept?.kind === kind ? kept.options : []);
  return {kind, list, options, control: kind === 'yes_no' ? 'yes_no' : kind === 'long_text' ? 'textarea' : (kind === 'single' || kind === 'multi') && options.length ? kind : 'text'};
}

// The mark a drawn format writes to the store (a text question: none): {kind, options, list} | null.
export const markFor = format => (!format || !WORDS[format.kind] ? null : {kind: format.kind, options: format.list || format.kind === 'yes_no' ? [] : format.options || [], ...(format.list ? {list: format.list} : {})});

// A multi answer is stored as one line: "A, B"; read back into its picks (only those that are options).
export const joinPicks = picks => picks.filter(Boolean).join(', ');
export const picksOf = (value, options) => options.filter(option => String(value || '').split(/\s*,\s*/).some(part => part.toLowerCase() === option.toLowerCase()));

// A proposed answer as the row's control can take it: the option that names it (a pick: each part), else '' (the person answers); a text box takes any value.
export function proposalIn(value, {control = 'text', options = []} = {}) {
  const text = String(value || '').trim();
  if (control === 'text' || control === 'textarea') return text;
  if (control === 'multi') return joinPicks(picksOf(text, options));
  return options.find(option => option.toLowerCase() === text.toLowerCase()) || '';
}

// The words a person reads for a kind (the "Answer as" choice).
export const KIND_NAMES = {text: 'Text', long_text: 'Long text', single: 'Pick one', multi: 'Pick several', yes_no: 'Yes / No'};

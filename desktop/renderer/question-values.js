// The saved text of the base-fact kinds that hold more than one part (owner, 17 Oct 2026: "Base facts fixed, AI the rest"): a salary (amount, currency, period,
// net or gross), a duration (a notice period), a work status per country, a language level, a range and a link. Each pair reads the text the store keeps and
// writes it back the same way; text the code cannot read gives empty parts, so the control shows it as it was written and nothing is lost.
// Pure (no DOM): guarded by test/question-kinds-composite.test.js.

export const CURRENCIES_ALL = ['CHF', 'EUR', 'USD', 'GBP', 'AED', 'AUD', 'CAD', 'SEK'];
export const PERIODS = ['hour', 'day', 'week', 'month', 'year'];
export const BASES = ['gross', 'net'];
export const UNITS = ['day', 'week', 'month', 'year'];
export const STATUSES = ['allowed', 'needs visa'];
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'];

const NUMBER = String.raw`(\d[\d'’,.\s]*?)`;
const SALARY = new RegExp(String.raw`^${NUMBER}\s*([A-Z]{3})(?:\s*/\s*(${PERIODS.join('|')}))?(?:\s+(${BASES.join('|')}))?$`);

// "150000 CHF/year gross" -> {number, currency, period, basis}; "95000 CHF" (an amount saved before this kind) has no period.
export function splitSalary(value) {
  const match = String(value ?? '').trim().match(SALARY);
  return match ? {number: match[1].trim(), currency: match[2], period: match[3] || '', basis: match[4] || ''} : {number: '', currency: '', period: '', basis: ''};
}
export function joinSalary({number = '', currency = '', period = '', basis = ''} = {}) {
  return String(number).trim() ? `${String(number).trim()} ${currency}${period ? `/${period}` : ''}${basis ? ` ${basis}` : ''}`.trim() : '';
}

const DURATION = new RegExp(String.raw`^(\d+)\s*(${UNITS.join('|')})s?(,\s*ends at month-end)?$`, 'i');
export function splitDuration(value) {
  const match = String(value ?? '').trim().match(DURATION);
  return match ? {number: match[1], unit: match[2].toLowerCase(), monthEnd: Boolean(match[3])} : {number: '', unit: '', monthEnd: false};
}
export function joinDuration({number = '', unit = '', monthEnd = false} = {}) {
  const count = String(number).trim();
  return count && unit ? `${count} ${unit}${Number(count) === 1 ? '' : 's'}${monthEnd ? ', ends at month-end' : ''}` : '';
}

const PERMIT = /^(allowed|needs visa)(?:\s*,\s*(.+))?$/i;
export function splitPermit(value) {
  const match = String(value ?? '').trim().match(PERMIT);
  return match ? {status: match[1].toLowerCase(), permit: (match[2] || '').trim()} : {status: '', permit: ''};
}
export const joinPermit = ({status = '', permit = ''} = {}) => (status ? `${status}${String(permit).trim() ? `, ${String(permit).trim()}` : ''}` : '');

const RANGE = /^(\d{1,3})\s*[-–]\s*(\d{1,3})\s*%?$/;
export function splitRange(value) {
  const match = String(value ?? '').trim().match(RANGE);
  return match ? {from: match[1], to: match[2]} : {from: '', to: ''};
}
export const joinRange = ({from = '', to = ''} = {}) => (String(from).trim() && String(to).trim() ? `${String(from).trim()}–${String(to).trim()} %` : '');

// Only a web address; "javascript:" and the like are never a link.
export const isLink = text => /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(String(text ?? '').trim());

// The saved text of a kind in its own wording, or '' when the code cannot read it (the line then stays as written, with its mark and a "Check").
export function canonical(kind, value) {
  const text = String(value ?? '').trim();
  if (kind === 'salary') return joinSalary(splitSalary(text));
  if (kind === 'duration') return joinDuration(splitDuration(text));
  if (kind === 'per_country') return joinPermit(splitPermit(text));
  if (kind === 'range') return joinRange(splitRange(text));
  if (kind === 'language') return LEVELS.find(level => level.toLowerCase() === text.toLowerCase()) || '';
  return kind === 'link' && isLink(text) ? text : '';
}

// An AI-written canonical text keeps the original's meaning: the same numbers (no more, no fewer), and a language level the original names.
const numbersOf = text => (String(text).match(/\d[\d'’,.]*\d|\d/g) || []).map(each => each.replace(/\D/g, '')).sort().join('|');
export function faithful(kind, original, text) {
  if (!canonical(kind, text)) return false;
  if (kind === 'salary' || kind === 'duration' || kind === 'range') return numbersOf(original) === numbersOf(text);
  if (kind === 'language') return String(original).toLowerCase().includes(String(text).toLowerCase());
  return String(original).trim() === String(text).trim();
}

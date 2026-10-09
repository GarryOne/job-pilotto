// One date format for the screens: "8 Oct", and "8 Oct 2025" only when it isn't this year (owner, 9 Oct 2026). A date alone
// ("2026-10-08") is read at noon, so no time zone moves it a day; an unreadable value gives ''. Guarded by test/date.test.js.
export function shortDay(value, now = Date.now()) {
  const text = String(value || '');
  const at = Date.parse(text.length === 10 ? `${text}T12:00:00` : text);
  if (!text || !Number.isFinite(at)) return '';
  const thisYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', ...(thisYear ? {} : {year: 'numeric'})});
}

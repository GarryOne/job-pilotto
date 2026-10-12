// The fill ladder's value class (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 3; the owner's case c, 12 Oct 2026: "+41" pushed into a Country dropdown): the KIND
// of value the fill gave a control, from a fixed list, computed here on the person's computer from the fill's own answer, so the fill check and the repair question
// (desktop/lib/ladder/fill-verify.js, fill-repair.js) can see that a calling code went into a country menu without ever seeing the value. Shapes only, no word list: calling codes
// and country names come from the dial-code table (page/dial-codes.js) named by the browser itself (Intl.DisplayNames, in the page's language and English).
// The fill marks each answered control with its class (data-jobpilotto-class, page/fill.js); the judges' sketch reads that mark (extension/account-fill.js).
// The list is the desktop's VALUE_CLASSES too (desktop/lib/ladder/fill-repair.js; desktop/test/fill-repair.test.js fails when they differ). Guard: worker/test/value-class.test.js.
(() => {
  if (window.__jobPilottoValueClass) return;
  const CLASSES = ['dial_code', 'country_name', 'email_shaped', 'phone', 'date', 'number', 'url', 'free_text', 'none'];
  const fold = text => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  let countries = null;
  // Every country name of the dial-code table's regions, in the page's language and in English (built once, on first use).
  const countryNames = () => {
    if (countries) return countries;
    countries = new Set();
    const regions = Object.values(window.__jobPilottoDialRegion || {});
    for (const lang of [...new Set([document.documentElement?.lang?.split('-')[0], 'en'].filter(Boolean))]) {
      let names = null;
      try { names = new Intl.DisplayNames([lang], {type: 'region'}); } catch { continue; }
      for (const region of regions) { const name = fold(names.of(region)); if (name && name !== fold(region)) countries.add(name); }
    }
    return countries;
  };
  const digits = text => (String(text).match(/\d/g) || []).length;
  // A date in the writings forms ask for: 2026-11-02, 02.11.2026, 02/11/2026, 11-02-2026 (day and month in range).
  const DATE = [/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/, /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/];
  const isDate = text => DATE.some((shape, i) => {
    const found = text.match(shape);
    if (!found) return false;
    const [a, b] = i === 0 ? [Number(found[2]), Number(found[3])] : [Number(found[1]), Number(found[2])];
    return a >= 1 && b >= 1 && Math.min(a, b) <= 12 && Math.max(a, b) <= 31;
  });
  // value (the fill's answer) -> one of CLASSES.
  const of = value => {
    const text = String(value ?? '').trim();
    if (!text) return 'none';
    const code = text.replace(/^00(?=\d)/, '+').replace(/\s/g, '');
    if (/^\+\d{1,4}$/.test(code) && (window.__jobPilottoDialRegion || {})[code]) return 'dial_code';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'email_shaped';
    if (/^(https?:\/\/|www\.)\S+$/i.test(text) || /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+\/\S*$/u.test(text)) return 'url';
    if (isDate(text)) return 'date';
    if (/^[+(]?[\d\s().\-/]+$/.test(text) && digits(text) >= 6 && digits(text) <= 15 && !/^-?\d+([.,]\d+)?$/.test(text)) return 'phone';
    if (/^-?\d+([.,]\d+)?$/.test(text)) return digits(text) >= 9 && !/[.,]/.test(text) ? 'phone' : 'number';
    if (countryNames().has(fold(text))) return 'country_name';
    return 'free_text';
  };
  // The fill's answers ([{field, value}]) -> each answered control marked with its class (a radio or checkbox group is a choice, not a typed value: not marked).
  const mark = answers => {
    for (const item of answers || []) {
      const field = String(item?.field || '');
      if (!field || /^(radio|group):/.test(field)) continue;
      const el = document.getElementById(field) || document.querySelector(`[name="${CSS.escape(field)}"]`);
      if (el && el.matches('input, select, textarea') && !['checkbox', 'radio', 'file', 'password'].includes(el.type)) el.setAttribute('data-jobpilotto-class', of(item.value));
    }
  };
  window.__jobPilottoValueClass = {CLASSES, of, mark};
})();

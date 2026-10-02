// Generic operators: one small, verified way to read and set each kind of control, found by what it does and not by which
// site draws it (docs: Notion "Self-improving form filling", step 2). Each operator finds its target, sets it the way a person
// would (a click, typing), re-reads it, and says whether it worked. They only touch the control an answer was matched to,
// never a Submit button and never a consent box. Loaded in the page before fill.js; also loaded by the tests (module.exports).
(() => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = text => String(text || '').replace(/\s+/g, ' ').replace(/\s*\*+\s*$/, '').trim();
  const norm = text => clean(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // ---- answers -> what a control can take ----
  const YES = new Set(['yes', 'y', 'true', 'ja', 'oui', 'si', 'sim', 'da']);
  const NO = new Set(['no', 'n', 'false', 'nein', 'non', 'nao', 'nu']);
  // 'yes' | 'no' | '' for an answer written many ways ("Yes, I am", "No.").
  function yesNo(value) {
    const first = norm(value).split(' ')[0];
    return YES.has(first) ? 'yes' : NO.has(first) ? 'no' : '';
  }
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  // A date written as yyyy-mm-dd, dd.mm.yyyy, dd/mm/yyyy or "1 Nov 2026" -> {y, m, d}, else null. A slash date is day first:
  // the people and forms this serves write dd/mm; a month above 12 settles it the other way.
  function parseDate(text) {
    const t = String(text || '').trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
    if (m) return valid({y: +m[1], m: +m[2], d: +m[3]});
    m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
    if (m) return +m[2] > 12 && +m[1] <= 12 ? valid({y: +m[3], m: +m[1], d: +m[2]}) : valid({y: +m[3], m: +m[2], d: +m[1]});
    m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(t);
    if (m && MONTHS.includes(m[2].toLowerCase())) return valid({y: +m[3], m: MONTHS.indexOf(m[2].toLowerCase()) + 1, d: +m[1]});
    return null;
  }
  function valid(date) {
    return date.m >= 1 && date.m <= 12 && date.d >= 1 && date.d <= 31 && date.y >= 1900 && date.y <= 2100 ? date : null;
  }
  const two = n => String(n).padStart(2, '0');
  // How this field wants the date: from its type, or its placeholder (dd.mm.yyyy, mm/dd/yyyy, yyyy-mm-dd); else month first
  // (the US-style pickers that say only "Pick date...").
  function formatDate(date, input) {
    if (input.type === 'date') return `${date.y}-${two(date.m)}-${two(date.d)}`;
    const hint = String(input.placeholder || '').toLowerCase();
    const sep = (/[dmy]{2,4}([^a-z\s])[dmy]{2,4}/.exec(hint) || [])[1] || '/';   // the separator between format letters, not a trailing "..."
    const order = hint.indexOf('yyyy') === 0 ? 'ymd'
      : hint.indexOf('dd') >= 0 && hint.indexOf('mm') >= 0 ? (hint.indexOf('dd') < hint.indexOf('mm') ? 'dmy' : 'mdy') : 'mdy';
    const parts = {d: two(date.d), m: two(date.m), y: String(date.y)};
    return order.split('').map(letter => parts[letter]).join(sep);
  }

  // ---- finding the question a control answers ----
  function titleOf(el) {
    for (let up = el.parentElement, i = 0; up && i < 5; up = up.parentElement, i++) {
      const found = up.querySelector('label, legend, [class*=title], [class*=heading]');
      if (found && clean(found.textContent)) return clean(found.textContent);
    }
    return '';
  }
  // The ids a page may give the control: its own and its hidden input's, and the field entry's path (Ashby).
  function idsOf(el) {
    const ids = new Set();
    for (const node of [el, ...el.querySelectorAll?.('input, select, textarea') || []]) {
      for (const name of ['id', 'name']) { const value = node.getAttribute?.(name); if (value) ids.add(value); }
    }
    const entry = el.closest?.('[data-field-path]');
    if (entry) ids.add(entry.getAttribute('data-field-path'));
    return ids;
  }
  // The answer for a control: by field id when the page exposes one, else by the question text (equal, or one inside the other).
  function matchAnswer(answers, {ids, question}) {
    const q = norm(question);
    return answers.find(answer => answer.field && ids.has(answer.field))
      || answers.find(answer => answer.question && q && (norm(answer.question) === q
        || (q.length > 12 && (norm(answer.question).includes(q) || q.includes(norm(answer.question))))));
  }

  // ---- operators: each returns {ok, why} after re-reading the control ----
  // A group of pressable buttons (Yes/No, Male/Female): press the one whose text is the answer.
  async function setToggleGroup(box, value) {
    const buttons = [...box.querySelectorAll('button[aria-pressed], [role=radio], button[aria-checked]')];
    const wanted = yesNo(value) || norm(value);
    const target = buttons.find(button => (yesNo(button.textContent) || norm(button.textContent)) === wanted);
    if (!target) return {ok: false, why: `no "${clean(value)}" option`};
    const on = button => button.getAttribute('aria-pressed') === 'true' || button.getAttribute('aria-checked') === 'true';
    if (!on(target)) target.click();
    await wait(120);
    return on(target) ? {ok: true} : {ok: false, why: 'the option did not stay selected'};
  }
  // A text/date input: set like typing, then confirm the page kept it.
  async function setDate(input, value) {
    const date = parseDate(value);
    if (!date) return {ok: false, why: `"${clean(value)}" is not a date`};
    const text = formatDate(date, input);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    input.focus?.();
    if (setter) setter.call(input, text); else input.value = text;
    for (const type of ['input', 'change', 'blur']) input.dispatchEvent(new Event(type, {bubbles: true}));
    await wait(200);
    return input.value === text ? {ok: true, text} : {ok: false, why: 'the field did not keep the date'};
  }
  // A custom dropdown (a button or role=combobox that opens a list): open it, pick the option by its text, confirm the value shown.
  async function setCustomSelect(trigger, value, doc = document) {
    const wanted = norm(value);
    trigger.click();
    let options = [];
    for (let i = 0; i < 8 && !options.length; i++) {
      await wait(100);
      options = [...doc.querySelectorAll('[role=option], [role=listbox] li, [class*=option]')]
        .filter(option => option.getClientRects().length && !option.children?.length && clean(option.textContent));
    }
    const pick = options.find(option => norm(option.textContent) === wanted) || options.find(option => norm(option.textContent).startsWith(wanted));
    if (!pick) { trigger.click(); return {ok: false, why: options.length ? `no option "${clean(value)}"` : 'the list did not open'}; }
    pick.click();
    await wait(150);
    return norm(trigger.textContent || trigger.value).includes(norm(pick.textContent)) ? {ok: true} : {ok: false, why: 'the choice did not show'};
  }

  // Offer every control the normal fill left to the operators, with the same answers. Returns what happened per control.
  // `skip(question)` says a question is off limits (consent, terms): such controls are never touched.
  async function fill(answers, {skip = () => false, doc = document, kit = window.__jobPilottoSkeleton} = {}) {
    const results = [];
    const open = (answers || []).filter(answer => answer && answer.value !== undefined && answer.value !== '');
    const visible = el => !!(el.getClientRects().length && (typeof getComputedStyle !== 'function' || getComputedStyle(el).visibility !== 'hidden'));
    const used = new Set();
    const attempt = async (el, kind, run) => {
      const question = titleOf(el);
      if (!question || skip(question)) return;
      const answer = matchAnswer(open.filter(a => !used.has(a)), {ids: idsOf(el), question});
      if (!answer) return;
      used.add(answer);
      const result = await run(answer.value).catch(error => ({ok: false, why: error.message}));
      let fp = '';
      try { fp = kit ? kit.fingerprint(kit.skeleton(el)) : ''; } catch { /* a page that hides its own nodes */ }
      results.push({question, kind, fp, value: answer.value, ...result});
    };
    for (const {el, kind} of kit ? kit.widgets(doc, visible) : []) {
      if (kind === 'toggle-group' && !el.querySelector('[aria-pressed="true"], [aria-checked="true"]')) await attempt(el, kind, value => setToggleGroup(el, value));
      if (kind === 'custom-select') await attempt(el, kind, value => setCustomSelect(el, value, doc));
    }
    for (const input of doc.querySelectorAll('input')) {
      const looksLikeDate = input.type === 'date' || /date/i.test(`${input.placeholder || ''} ${input.className || ''}`);
      if (!looksLikeDate || input.value || !visible(input)) continue;
      await attempt(input, 'date', value => setDate(input, value));
    }
    return results;
  }

  const api = {yesNo, parseDate, formatDate, matchAnswer, titleOf, idsOf, setToggleGroup, setDate, setCustomSelect, fill, norm};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.__jobPilottoControls = api;
})();

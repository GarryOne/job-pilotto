// The form filler's reader (split from page/fill.js, 9 Oct 2026): every question on the visible page with its choices (__jobPilottoDescribeForm),
// the page's text, checkbox groups that are one question, and your contact details placed by label (built-in patterns, then the service's
// meanings). No applicant values are read. Needs page/fill-labels.js first. Guarded by worker/test/fill-learning.test.js, aliases.test.js.
(() => {
  if (window.__jobPilottoFillReadLoaded) return;
  window.__jobPilottoFillReadLoaded = true;
  const {LEGAL, clean, labelOf, questionOf, fieldsetTitle, titleRequired, visible, isCombo, comboValue, radioOps} = window.__jobPilottoFillKit;

  const PROFILE_LABELS = [
    ['first_name', /first\s*name|given\s*name|vorname|prénom/i],
    ['last_name', /last\s*name|family\s*name|surname|nachname|nom de famille/i],
    ['full_name', /^\s*(full\s*)?name\s*\*?\s*$|full\s*name/i],
    ['email', /e-?mail/i],
    ['phone', /phone|mobile|telefon|téléphone/i],
    ['linkedin', /linked\s*in/i],
    ['github', /github/i],
    ['website', /website|portfolio|personal\s*(site|page)/i],
    ['location', /^\s*(current\s*)?(location|city)\b/i],
    ['street', /^\s*(street(\s*address)?|strasse|stra\u00dfe|rue|address(\s*line\s*1)?)\s*\*?\s*$/i],
    ['postal_code', /\b(npa|postal\s*code|post\s*code|zip(\s*code)?|plz|code postal)\b/i],
    ['place_of_origin', /place\s*of\s*origin|heimatort|lieu d.origine/i],
    ['birth_date', /date\s*of\s*birth|birth\s*date|birthday|geburtsdatum|date de naissance/i],
  ];
  const TEXT_TYPES = ['text', 'email', 'tel', 'url', 'number', 'textarea'];

  // Meanings from the service ("Heimatort" -> place_of_origin; extension/alias-schema.js, whose aliasKey this copies as a plain script, a test
  // keeps them agreeing). Asked only when no built-in pattern above matched, so the service can add meanings but never override these.
  const aliasFor = label => {
    const text = clean(label).toLowerCase().replace(/\*+/g, '').replace(/\((optional|required|erforderlich|obligatoire)\)/g, '').replace(/^\s*\d+[.)]\s+/, '').replace(/[\s:;,.?!-]+$/g, '').trim();
    if (text.length < 3 || text.length > 100 || /@|https?:|www\./.test(text)) return null;
    for (const item of window.__jobPilottoAliases || []) {
      if (item && item.key && !/^(resume|cover_letter)$/.test(item.key) && item.phrase && (text === item.phrase || ` ${text} `.includes(` ${item.phrase} `))) return item;
    }
    return null;
  };
  // Contact details by field label, for the fields every board names differently.
  window.__jobPilottoProfileEntries = (rows, profile, taken = []) => {
    const used = new Set(taken);
    const entries = [];
    window.__jobPilottoAliasUsed = {};   // field -> the phrase that placed it (reported as counts, never the answer)
    for (const row of rows) {
      if (row.filled || row.legal || used.has(row.field) || !TEXT_TYPES.includes(row.type)) continue;
      if (/middle|maiden|nick/i.test(row.label || '')) continue;  // "Preferred first name" = your first name
      const match = PROFILE_LABELS.find(([key, pattern]) => profile[key] && pattern.test(row.label || row.field));
      const alias = match ? null : aliasFor(row.label);
      const key = match ? match[0] : alias && profile[alias.key] ? alias.key : '';
      if (!key) continue;
      if (key === 'full_name' && rows.some(r => /first\s*name/i.test(r.label))) continue;
      entries.push({field: row.field, value: String(profile[key])});
      if (alias) window.__jobPilottoAliasUsed[row.field] = alias.phrase;
      used.add(row.field);
    }
    return entries;
  };

  // Every question on the visible page, with the choices it offers. No applicant values.
  window.__jobPilottoDescribeForm = async () => {
    const fields = [];
    const controls = Array.from(document.querySelectorAll('input, textarea, select')).filter(el => visible(el) &&
      !el.disabled && el.getAttribute('aria-hidden') !== 'true' &&
      !['hidden', 'submit', 'button', 'reset', 'search', 'file', 'image'].includes(el.type));
    const groups = new Set();
    let unnamed = 0;
    for (const el of controls) {
      // A field with neither id nor name (Ashby's location box) gets one, so it can be answered and filled like any other.
      if (!el.id && !el.name && el.type !== 'radio' && el.type !== 'checkbox') el.id = `jp-field-${++unnamed}`;
      if (el.type === 'radio') {
        if (!el.name || groups.has(el.name)) continue;
        groups.add(el.name);
        const radios = controls.filter(r => r.type === 'radio' && r.name === el.name);
        const question = questionOf(el) || labelOf(el);
        fields.push({field: `radio:${el.name}`, label: question, type: 'radio',
          required: radios.some(r => r.required || r.getAttribute('aria-required') === 'true') || titleRequired(fieldsetTitle(el.closest('fieldset'))),
          options: radios.map(labelOf), filled: radios.some(r => r.checked), legal: LEGAL.test(question)});
      } else if (el.type === 'checkbox') {
        const label = labelOf(el);
        const question = questionOf(el);
        fields.push({field: el.id || el.name, label: question && question !== label ? `${question}: ${label}` : label,
          type: 'checkbox', required: el.required, filled: el.checked, legal: LEGAL.test(`${question} ${label}`)});
      } else if (isCombo(el)) {
        fields.push({field: el.id || el.name, label: labelOf(el), type: 'combobox',
          required: el.getAttribute('aria-required') === 'true' || el.required, filled: !!comboValue(el),
          legal: LEGAL.test(labelOf(el))});
      } else {
        const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : el.type || 'text';
        fields.push({field: el.id || el.name, label: labelOf(el), type, required: el.required || el.getAttribute('aria-required') === 'true',
          ...(type === 'select' ? {options: Array.from(el.options).map(o => clean(o.text)).filter(Boolean)} : {}),
          filled: type === 'select' ? el.selectedIndex > 0 : !!String(el.value || '').trim(), legal: LEGAL.test(labelOf(el))});
      }
    }
    fields.push(...radioOps.ariaFields());   // ARIA radio groups (page/radios.js)
    return fields.filter(f => f.field);
  };

  window.__jobPilottoPageText = () => clean(document.body?.innerText || '').slice(0, 12000);

  window.__jobPilottoCheckboxQuestions = () => {
    const groups = {};
    for (const b of document.querySelectorAll('input[type=checkbox]')) {
      const q = questionOf(b);
      if (q && visible(b)) (groups[q] ||= []).push(labelOf(b));
    }
    return Object.entries(groups).filter(([, options]) => options.length > 1).map(([question, options]) => ({question, options}));
  };
  Object.assign(window.__jobPilottoFillKit, {PROFILE_LABELS, TEXT_TYPES, aliasFor});
})();

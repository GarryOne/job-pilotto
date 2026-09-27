// Runs in the application page (main world) after browser-submit-guard.js and browser-form-fastpath.js.
// Fills the kit's answers and your contact details, then reports what is still open. It never clicks
// Submit or legal checkboxes (the guard blocks both until you unlock), and it returns field labels and
// counts, never your personal values.
(() => {
  // Contact details matched by field label, for the fields every board names differently.
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
  ];
  const TEXT_TYPES = ['text', 'email', 'tel', 'url', 'textarea'];

  // Which empty text fields get which profile value; kit answers and filled fields are left alone.
  window.__jobPilottoProfileEntries = (rows, profile, taken = []) => {
    const used = new Set(taken);
    const entries = [];
    for (const row of rows) {
      if (row.filled || row.legal || used.has(row.field) || !TEXT_TYPES.includes(row.type)) continue;
      const match = PROFILE_LABELS.find(([key, pattern]) => profile[key] && pattern.test(row.label || row.field));
      if (!match) continue;
      // "Name" alone means the full name only when the form has no separate first/last fields.
      if (match[0] === 'full_name' && rows.some(r => /first\s*name/i.test(r.label))) continue;
      entries.push({field: row.field, value: String(profile[match[0]])});
      used.add(row.field);
    }
    return entries;
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const byField = field => document.getElementById(field) ||
    Array.from(document.querySelectorAll('input, textarea, select')).find(el => el.name === field);

  // react-select dropdowns (Greenhouse) open on mousedown; then the option is picked by exact text.
  const pickOption = async (field, answer) => {
    const input = byField(field);
    if (!input) return false;
    const control = input.closest('[class*=control]') || input;
    input.focus();
    control.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
    await sleep(200);
    const result = window.__jobPilottoClickOption(answer);
    if (!result.ok) input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    await sleep(100);
    return result.ok;
  };

  window.__jobPilottoExtensionFill = async (answers, profile) => {
    if (!window.__jobPilottoGuardActive) return {error: 'The submit guard did not load; nothing was filled.'};
    const before = window.__jobPilottoAuditVisibleFields();
    const rowOf = Object.fromEntries(before.map(row => [row.field, row]));
    const onPage = answers.filter(a => rowOf[a.field] && !rowOf[a.field].filled && !rowOf[a.field].legal);
    const combos = onPage.filter(a => rowOf[a.field].type === 'combobox');
    const plain = onPage.filter(a => rowOf[a.field].type !== 'combobox').map(a => ({field: a.field, value: a.answer}));
    const contact = window.__jobPilottoProfileEntries(before, profile || {}, answers.map(a => a.field));
    const result = window.__jobPilottoFillKnownFields([...plain, ...contact]);
    const picked = [], toPick = [];
    for (const item of combos) {
      if (await pickOption(item.field, item.answer)) picked.push(item.question || item.field);
      else toPick.push({question: item.question || item.field, answer: item.answer});
    }
    const after = window.__jobPilottoAuditVisibleFields();
    const open = after.filter(row => row.required && !row.filled);
    return {
      filled: (result.filled || []).length + picked.length,
      contact: contact.length,
      toPick,
      resumeMissing: open.some(row => row.field === 'resume'),
      legalLeft: after.filter(row => row.legal && !row.filled).map(row => row.label).slice(0, 5),
      stillRequired: open.filter(row => row.field !== 'resume' && !row.legal).map(row => row.label || row.field).slice(0, 15),
      notOnPage: answers.filter(a => !rowOf[a.field]).length,
    };
  };
})();

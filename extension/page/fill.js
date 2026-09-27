// Runs in the application page (main world) after browser-submit-guard.js and browser-form-fastpath.js.
// Describes the form (labels, types, options; never your values), fills answers of every field type,
// attaches the CV, and shows what is left in a panel on the page. It never clicks Submit or legal
// checkboxes: the guard blocks both until you unlock them yourself.
(() => {
  if (window.__jobPilottoFillLoaded) return;
  window.__jobPilottoFillLoaded = true;

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
  const TEXT_TYPES = ['text', 'email', 'tel', 'url', 'number', 'textarea'];
  // Phone widgets with a separate country menu: the country comes from the number's prefix.
  const DIAL = {'+1': 'United States', '+30': 'Greece', '+31': 'Netherlands', '+32': 'Belgium', '+33': 'France', '+34': 'Spain',
    '+36': 'Hungary', '+39': 'Italy', '+40': 'Romania', '+41': 'Switzerland', '+43': 'Austria', '+44': 'United Kingdom',
    '+45': 'Denmark', '+46': 'Sweden', '+47': 'Norway', '+48': 'Poland', '+49': 'Germany', '+351': 'Portugal', '+353': 'Ireland',
    '+358': 'Finland', '+373': 'Moldova', '+380': 'Ukraine', '+420': 'Czech Republic', '+421': 'Slovakia', '+972': 'Israel',
    '+971': 'United Arab Emirates', '+91': 'India', '+86': 'China', '+81': 'Japan', '+61': 'Australia', '+55': 'Brazil'};
  const dialOf = phone => Object.keys(DIAL).sort((a, b) => b.length - a.length).find(code => String(phone || '').replace(/\s/g, '').startsWith(code));
  const LEGAL = /(^|\b)(i agree|i accept|terms|privacy|consent|acknowledg|authorize|certify)(\b|$)/i;
  const clean = text => String(text || '').replace(/\s+/g, ' ').replace(/\*\s*$/, '').trim();
  const norm = text => clean(text).toLowerCase();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  // Contact details by field label, for the fields every board names differently.
  window.__jobPilottoProfileEntries = (rows, profile, taken = []) => {
    const used = new Set(taken);
    const entries = [];
    for (const row of rows) {
      if (row.filled || row.legal || used.has(row.field) || !TEXT_TYPES.includes(row.type)) continue;
      if (/middle|maiden|nick/i.test(row.label || '')) continue;  // "Preferred first name" = your first name
      const match = PROFILE_LABELS.find(([key, pattern]) => profile[key] && pattern.test(row.label || row.field));
      if (!match) continue;
      if (match[0] === 'full_name' && rows.some(r => /first\s*name/i.test(r.label))) continue;
      entries.push({field: row.field, value: String(profile[match[0]])});
      used.add(row.field);
    }
    return entries;
  };

  const labelOf = el => {
    const own = Array.from(el.labels || [], l => l.textContent).join(' ') || el.getAttribute('aria-label');
    const byId = el.getAttribute('aria-labelledby');
    const labelled = byId && byId.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
    return clean(own || labelled || el.getAttribute('placeholder') || el.name || el.id);
  };
  // The question a radio group or checkbox belongs to: its fieldset legend or group label.
  const questionOf = el => clean(el.closest('fieldset')?.querySelector('legend')?.textContent ||
    el.closest('[role=radiogroup], [role=group]')?.getAttribute('aria-label') ||
    el.closest('[role=radiogroup], [role=group]')?.querySelector('label, legend, span')?.textContent || '');
  const isCombo = el => el.getAttribute('role') === 'combobox';
  const comboControl = el => el.closest('[class*=control]') || el;
  const comboValue = el => (el.closest('[class*=select__container]') || el.closest('[class*=container]'))
    ?.querySelector('[class*=single-value], [class*=multi-value]');

  // Searchable dropdowns (react-select on Greenhouse) only open for real user input: scripted clicks
  // and keys are ignored (checked on a live form, 27 Sep 2026). So the extension never opens them;
  // it marks each one, and when you click it, picks the answer in the menu your click opened.
  const OPTION = '[class*="option"], [role="option"]';
  // The innermost option elements of an open menu (not the phone field's hidden country list).
  const optionNodes = () => Array.from(document.querySelectorAll(OPTION))
    .filter(o => o.offsetParent !== null && !o.querySelector(OPTION) && !/iti__/.test(o.className));
  const matchOption = answer => {
    if (String(answer).includes(' || ')) {
      for (const alternative of String(answer).split(' || ')) { const hit = matchOption(alternative); if (hit) return hit; }
      return null;
    }
    const want = norm(answer);
    const options = optionNodes();
    // "Geneva, Switzerland": an option naming every part (Geneva … Switzerland), when only one does.
    const parts = want.split(/\s*,\s*/).filter(Boolean);
    if (parts.length > 1) {
      const all = options.filter(o => parts.every(part => norm(o.textContent).includes(part)));
      if (all.length >= 1) return all[0];
    }
    const exact = options.filter(o => norm(o.textContent) === want);
    if (exact.length === 1) return exact[0];
    const starts = options.filter(o => norm(o.textContent).startsWith(want));
    if (starts.length === 1) return starts[0];
    const contains = options.filter(o => norm(o.textContent).includes(want));
    return contains.length === 1 ? contains[0] : null;
  };

  // Every question on the visible page, with the choices it offers. No applicant values.
  window.__jobPilottoDescribeForm = async () => {
    const fields = [];
    const controls = Array.from(document.querySelectorAll('input, textarea, select')).filter(el => visible(el) &&
      !el.disabled && el.getAttribute('aria-hidden') !== 'true' &&
      !['hidden', 'submit', 'button', 'reset', 'search', 'file', 'image'].includes(el.type));
    const groups = new Set();
    for (const el of controls) {
      if (el.type === 'radio') {
        if (!el.name || groups.has(el.name)) continue;
        groups.add(el.name);
        const radios = controls.filter(r => r.type === 'radio' && r.name === el.name);
        const question = questionOf(el) || labelOf(el);
        fields.push({field: `radio:${el.name}`, label: question, type: 'radio', required: radios.some(r => r.required),
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
    return fields.filter(f => f.field);
  };

  window.__jobPilottoPageText = () => clean(document.body?.innerText || '').slice(0, 12000);

  // Mark a dropdown with its answer; your click opens the menu, and the answer is picked in it.
  const armCombo = (field, answer) => {
    const el = document.getElementById(field) || document.querySelector(`[name="${CSS.escape(field)}"]`);
    if (!el) return false;
    const control = comboControl(el);
    control.style.outline = '3px solid #d9540b';
    control.style.outlineOffset = '2px';
    const badge = document.createElement('div');
    badge.className = 'job-pilotto-badge';
    badge.textContent = `✈️ Click to choose: ${String(answer).split(' || ')[0]}`;
    badge.style.cssText = 'margin-top:4px;font:600 12px system-ui,sans-serif;color:#d9540b';
    control.parentElement.insertBefore(badge, control.nextSibling);
    control.dataset.jobpilottoArmed = labelOf(el) || field;
    const done = () => { control.style.outline = ''; badge.remove(); delete control.dataset.jobpilottoArmed; control.removeEventListener('mousedown', onOpen, true); };
    const onOpen = event => {
      if (!event.isTrusted) return;
      setTimeout(async () => {
        let option = matchOption(answer);
        if (!option) {
          // Long menus (countries, cities) show only their first entries: type the answer to filter,
          // which the menu accepts once your click has opened it.
          // Search-as-you-type fields (Location) load suggestions from the server: type the first part, wait for them.
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(answer).split(' || ')[0].split(',')[0].trim());
          el.dispatchEvent(new Event('input', {bubbles: true}));
          for (let waited = 0; waited < 4000 && !option; waited += 250) { await sleep(250); option = matchOption(answer); }
        }
        if (option) { option.click(); done(); }
        else badge.textContent = `✈️ Suggested: ${answer} (pick it yourself)`;
      }, 120);
    };
    control.addEventListener('mousedown', onOpen, true);
    return true;
  };

  const pickRadio = (name, answer) => {
    const radios = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`));
    const want = norm(answer);
    const match = radios.find(r => norm(labelOf(r)) === want) ||
      (radios.filter(r => norm(labelOf(r)).includes(want)).length === 1 ? radios.find(r => norm(labelOf(r)).includes(want)) : null);
    if (!match || LEGAL.test(`${questionOf(match)} ${labelOf(match)}`)) return false;
    if (!match.checked) match.click();
    return match.checked;
  };

  // A group of checkboxes that is one question ("How did you hear about us?": LinkedIn / Careers website / …):
  // tick the option whose label best matches the answer (exact, then contained either way, then shared words).
  const pickCheckboxOption = (question, answer) => {
    const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')).filter(b => questionOf(b) === question);
    if (!boxes.length || LEGAL.test(question)) return null;
    const want = norm(answer), words = want.split(/\W+/).filter(w => w.length > 3);
    const score = b => { const l = norm(labelOf(b)); return l === want ? 3 : (l.includes(want) || want.includes(l)) ? 2 : words.some(w => l.includes(w)) ? 1 : 0; };
    const best = boxes.reduce((a, b) => (score(b) > score(a) ? b : a), boxes[0]);
    if (!score(best)) return false;
    if (!best.checked) best.click();
    return best.checked;
  };
  window.__jobPilottoCheckboxQuestions = () => {
    const groups = {};
    for (const b of document.querySelectorAll('input[type=checkbox]')) {
      const q = questionOf(b);
      if (q && visible(b)) (groups[q] ||= []).push(labelOf(b));
    }
    return Object.entries(groups).filter(([, options]) => options.length > 1).map(([question, options]) => ({question, options}));
  };

  const setCheckbox = (field, answer) => {
    const box = document.getElementById(field) || document.querySelector(`input[type=checkbox][name="${CSS.escape(field)}"]`);
    if (!box || LEGAL.test(`${questionOf(box)} ${labelOf(box)}`)) return false;
    const want = /^(checked|yes|true)$/i.test(answer);
    if (box.checked !== want) box.click();
    return box.checked === want;
  };

  const attachResume = resume => {
    const inputs = Array.from(document.querySelectorAll('input[type=file]'));
    const context = el => `${el.id} ${el.name} ${el.getAttribute('aria-label') || ''} ${el.closest('div, fieldset, section')?.textContent || ''}`;
    const input = inputs.find(el => /resume|\bcv\b|lebenslauf/i.test(context(el))) || (inputs.length === 1 ? inputs[0] : null);
    if (!input || input.files?.length) return false;
    const bytes = Uint8Array.from(atob(resume.data), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], resume.name, {type: resume.type || 'application/pdf'}));
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  };

  // Tick every visible terms/privacy/consent box and hand Submit to the user (the extension never submits).
  const tickConsents = () => {
    window.__jobPilottoHandOver?.();
    const ticked = [];
    for (const box of document.querySelectorAll('input[type=checkbox]')) {
      const text = `${questionOf(box)} ${labelOf(box)}`;
      if (!visible(box) || box.checked || !LEGAL.test(text)) continue;
      box.click();
      if (box.checked) ticked.push(clean(String(questionOf(box) || labelOf(box)).replace(/\S*(_|\[\])\S*/g, ' ')).slice(0, 90));
    }
    return ticked;
  };

  const panel = summary => {
    document.getElementById('job-pilotto-panel')?.remove();
    const box = document.createElement('div');
    box.id = 'job-pilotto-panel';
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:320px;max-height:70vh;overflow:auto;' +
      'background:#132439;color:#fff;border-radius:10px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px #0008';
    const add = (text, style = '') => {
      const line = document.createElement('div');
      line.textContent = text;
      line.style.cssText = style;
      box.append(line);
      return line;
    };
    add(`✈️ Job Pilotto filled ${summary.filled} field(s)`, 'font-weight:600;margin-bottom:6px');
    if (summary.todo.length) {
      add('Still yours to do:', 'color:#ffb224;margin-top:4px');
      for (const item of summary.todo) add(`• ${item}`);
    } else add('Review everything, then press Submit.', 'color:#b9c8dc');
    // Consent boxes left: one click ticks them all and leaves Submit ready.
    if (summary.todo.some(item => item.startsWith('Your choice (legal)'))) {
      const tick = document.createElement('button');
      tick.textContent = '✓ Tick these for me';
      tick.style.cssText = 'margin:8px 8px 0 0;background:#d9540b;color:#fff;border:0;border-radius:5px;padding:5px 10px;cursor:pointer;font-weight:600';
      tick.onclick = () => {
        const ticked = tickConsents();
        panel({...summary, filled: summary.filled + ticked.length,
          todo: [...summary.todo.filter(item => !item.startsWith('Your choice (legal)')), ...ticked.map(t => `Ticked for you: ${t}`)]});
      };
      box.append(tick);
      add('Always do this: extension Settings → "Tick terms and consent boxes for me".', 'color:#8fa3bb;font-size:11.5px;margin-top:4px');
    }
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.cssText = 'margin-top:8px;background:#fff;color:#132439;border:0;border-radius:5px;padding:4px 10px;cursor:pointer';
    close.onclick = () => box.remove();
    box.append(close);
    document.documentElement.append(box);
  };

  // answers: [{field, value, question?, confidence?, note?}] merged by the extension (AI + kit).
  // For "Fill drop-down menus too": the next armed dropdown, scrolled into view, as viewport coordinates
  // for a real click (sent by the extension through Chrome's debugger), or null when none is left.
  window.__jobPilottoNextCombo = async (skip = 0) => {
    const control = Array.from(document.querySelectorAll('[data-jobpilotto-armed]'))[skip];
    if (!control) return null;
    // Instant, not smooth: sites with smooth scrolling (Greenhouse) moved the menu after it was measured.
    control.scrollIntoView({block: 'center', behavior: 'instant'});
    await sleep(120);
    const rect = control.getBoundingClientRect();
    return {x: Math.round(rect.left + Math.min(40, rect.width / 2)), y: Math.round(rect.top + rect.height / 2),
      label: control.dataset.jobpilottoArmed};
  };
  window.__jobPilottoPanel = summary => panel(summary);
  // After the country menu is picked: where to type the national number (the widget adds the prefix).
  window.__jobPilottoPhoneSpot = async () => {
    const phone = window.__jobPilottoPhone;
    const el = phone && (document.getElementById(phone.field) || document.querySelector(`[name="${CSS.escape(phone.field)}"]`));
    if (!el) return null;
    el.scrollIntoView({block: 'center', behavior: 'instant'});
    await sleep(120);
    const rect = el.getBoundingClientRect();
    return {x: Math.round(rect.left + 30), y: Math.round(rect.top + rect.height / 2), text: phone.national};
  };
  window.__jobPilottoArmedCount = () => document.querySelectorAll('[data-jobpilotto-armed]').length;

  // Optional cover letter: a textarea labelled Cover letter, or behind an "Enter manually" button.
  const fillCoverLetter = async letter => {
    const find = () => Array.from(document.querySelectorAll('textarea')).find(el => visible(el) && /cover\s*letter/i.test(`${el.id} ${el.name} ${labelOf(el)}`));
    let box = find();
    if (!box) {
      const heading = Array.from(document.querySelectorAll('label, legend, h3, h4, div')).find(el => /^\s*cover\s*letter\s*\*?\s*$/i.test(el.textContent || ''));
      const scope = heading?.parentElement || document;
      const manual = Array.from(scope.querySelectorAll('button, a')).find(el => /enter manually|type it|paste/i.test(el.textContent || ''));
      if (!manual) return false;
      manual.click();
      for (let i = 0; i < 10 && !box; i++) { await sleep(150); box = find(); }
    }
    if (!box || String(box.value || '').trim()) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, letter);
    box.dispatchEvent(new Event('input', {bubbles: true}));
    box.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  };

  window.__jobPilottoExtensionFill = async (answers, profile, resume, coverLetter = '', acceptConsents = false) => {
    if (!window.__jobPilottoGuardActive) return {error: 'The submit guard did not load; nothing was filled.'};
    const form = await window.__jobPilottoDescribeForm();
    for (const group of window.__jobPilottoCheckboxQuestions()) {
      form.push({field: `group:${group.question}`, question: group.question, label: group.question, type: 'checkbox-group', options: group.options,
        filled: false, legal: LEGAL.test(group.question)});
    }
    const rowOf = Object.fromEntries(form.map(row => [row.field, row]));
    // Kit answers name fields as the job board does (question_123[]); a checkbox group is matched by its question.
    for (const item of answers) {
      if (rowOf[item.field] || !item.question) continue;
      const group = form.find(row => row.type === 'checkbox-group' && norm(row.question) === norm(item.question));
      if (group) item.field = group.field;
    }
    const contact = window.__jobPilottoProfileEntries(form, profile || {});
    const contactFields = new Set(contact.map(entry => entry.field));
    const todo = [], review = [], armed = [];
    document.querySelectorAll('.job-pilotto-badge').forEach(badge => badge.remove());
    let filled = 0;
    const plain = [];
    for (const item of answers) {
      const row = rowOf[item.field];
      if (!row || row.filled || row.legal || contactFields.has(item.field)) continue;
      if (['combobox', 'radio', 'checkbox'].includes(row.type)) continue;
      plain.push({field: item.field, value: item.value});
    }
    const typed = window.__jobPilottoFillKnownFields([...contact, ...plain]);
    filled += (typed.filled || []).length;
    for (const item of answers) {
      const row = rowOf[item.field];
      if (!row || row.filled || row.legal) continue;
      let ok = null;
      if (row.type === 'combobox') { if (armCombo(item.field, item.value)) armed.push(row.label); continue; }
      else if (row.type === 'radio') ok = pickRadio(item.field.slice(6), item.value);
      else if (row.type === 'checkbox') ok = setCheckbox(item.field, item.value);
      else if (row.type === 'checkbox-group') ok = pickCheckboxOption(row.question, item.value);
      if (ok === true) filled += 1;
      if (ok === false) todo.push(`Pick "${item.value}" for: ${row.label}`);
      if (ok !== false && item.confidence && item.confidence !== 'high') {
        review.push(`Check: ${row.label}${item.note ? ` (${item.note})` : ''}`);
      }
    }
    const answered = new Set(answers.map(a => a.field));
    // Voluntary demographic questions with no answer: pick the menu's decline option, whatever it's called.
    const DEMOGRAPHIC = /gender|race|ethnic|veteran|disabilit|sexual orientation|transgender|pronoun/i;
    const DECLINE = "I don't wish to answer || I do not wish to answer || Decline to self-identify || Decline to self identify || " +
      "Prefer not to say || Decline to answer || I do not want to answer || Choose not to disclose || I choose not to disclose || Not specified";
    for (const row of form) {
      if (row.type !== 'combobox' || row.filled || row.legal || answered.has(row.field) || !DEMOGRAPHIC.test(row.label || '')) continue;
      if (armCombo(row.field, DECLINE)) { armed.push(row.label); answers.push({field: row.field, value: 'Decline to self-identify', source: 'standard answer (demographics)'}); answered.add(row.field); }
    }
    const dial = dialOf(profile?.phone);
    const phoneRow = form.find(row => row.type === 'tel' || /phone|mobile/i.test(row.label || ''));
    if (dial && phoneRow) {
      const country = form.find(row => row.type === 'combobox' && /^\s*country\b/i.test(row.label || '') && !answered.has(row.field));
      if (country && armCombo(country.field, DIAL[dial])) {
        armed.push(country.label); answers.push({field: country.field, value: DIAL[dial], source: 'your details (phone prefix)'});
        answered.add(country.field);
        window.__jobPilottoPhone = {field: phoneRow.field, national: String(profile.phone).replace(/\s/g, '').slice(dial.length)};
      }
    }
    for (const row of form) {
      if (row.type !== 'combobox' || row.filled || row.legal || answered.has(row.field)) continue;
      const [key] = PROFILE_LABELS.find(([name, pattern]) => profile?.[name] && pattern.test(row.label || row.field)) || [];
      if (key && armCombo(row.field, String(profile[key]))) { armed.push(row.label); answers.push({field: row.field, value: profile[key], source: 'your details'}); }
    }
    if (armed.length) todo.unshift(`Click the ${armed.length} highlighted dropdown(s); each picks its answer when opened`);
    const resumeAttached = resume?.data ? attachResume(resume) : false;
    if (coverLetter && await fillCoverLetter(coverLetter)) filled += 1;
    await sleep(300);
    // One row per checkbox group (not per option); legal boxes named by their question, not their id.
    const groupOf = new Map();
    for (const b of document.querySelectorAll('input[type=checkbox]')) {
      const q = questionOf(b);
      if (q) groupOf.set(b.id || b.name, q);
    }
    const seenGroups = new Set();
    const after = window.__jobPilottoAuditVisibleFields().flatMap(row => {
      const q = row.type === 'checkbox' && groupOf.get(row.field);
      if (!q) return [row];
      const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')).filter(b => questionOf(b) === q);
      if (boxes.length < 2) return [{...row, label: q}];
      if (seenGroups.has(q)) return [];
      seenGroups.add(q);
      return [{...row, field: `group:${q}`, label: q, filled: boxes.some(b => b.checked), required: boxes.some(b => b.required) || row.required}];
    });
    const open = after.filter(row => row.required && !row.filled);
    if (open.some(row => row.field === 'resume') && !resumeAttached) todo.unshift('Upload your CV');
    const armedFields = new Set(answers.filter(a => rowOf[a.field]?.type === 'combobox').map(a => a.field));
    for (const row of open.filter(r => r.field !== 'resume' && !r.legal && !armedFields.has(r.field))) {
      todo.push(`Answer: ${rowOf[row.field]?.label || clean(row.label).replace(row.field, '').trim() || row.field}`);
    }
    const readable = text => clean(String(text || '').replace(/\S*(_|\[\])\S*/g, ' ')) || text;
    let consented = [];
    if (acceptConsents) {
      consented = tickConsents();
      filled += consented.length;
      for (const row of after) if (row.legal && consented.length) row.filled = row.filled || !!document.getElementById(row.field)?.checked;
    }
    const legal = [...after.filter(row => row.legal && !row.filled && !acceptConsents).map(row => `Your choice (legal): ${readable(row.label)}`),
      ...consented.map(text => `Ticked for you: ${text}`)];
    const unfilledRequired = open.filter(row => !(row.field === 'resume' && resumeAttached) && !row.legal).length;
    // Field-by-field log for the run record: where each answer came from and what happened.
    const answerOf = Object.fromEntries(answers.map(a => [a.field, a]));
    const trace = after.filter(row => row.field !== 'resume').map(row => {
      const label = rowOf[row.field]?.label || clean(row.label).replace(row.field, '').trim() || row.field;
      const answer = answerOf[row.field];
      const source = contactFields.has(row.field) ? 'your details' : answer ? (answer.source || 'kit') : '';
      let outcome = row.filled ? 'filled' : 'left';
      let reason = '';
      if (row.legal) { outcome = 'left'; reason = 'legal/consent: always your choice'; }
      else if (!row.filled && armedFields.has(row.field)) { outcome = 'left'; reason = 'dropdown that opens only on a real click'; }
      else if (!row.filled && !answer && !contactFields.has(row.field)) reason = 'no answer in the kit, Profile or your details';
      else if (!row.filled) reason = 'answer given, but the field did not take it';
      return {label: label.slice(0, 120), required: !!row.required, type: rowOf[row.field]?.type || '', source, outcome, reason,
        low: answer && answer.confidence && answer.confidence !== 'high' ? (answer.note || 'low confidence') : ''};
    });
    trace.push({label: 'CV', required: true, type: 'file', source: 'your CV', outcome: resumeAttached ? 'filled' : 'left',
      reason: resumeAttached ? '' : 'no CV in the app'});
    const summary = {filled, unfilledRequired, contact: contact.length, resumeAttached, trace, todo: [...new Set([...todo, ...review, ...legal])].slice(0, 25)};
    panel(summary);
    return summary;
  };
})();

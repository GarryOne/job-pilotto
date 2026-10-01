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
    ['street', /^\s*(street(\s*address)?|strasse|stra\u00dfe|rue|address(\s*line\s*1)?)\s*\*?\s*$/i],
    ['postal_code', /\b(npa|postal\s*code|post\s*code|zip(\s*code)?|plz|code postal)\b/i],
    ['place_of_origin', /place\s*of\s*origin|heimatort|lieu d.origine/i],
    ['birth_date', /date\s*of\s*birth|birth\s*date|birthday|geburtsdatum|date de naissance/i],
  ];
  const TEXT_TYPES = ['text', 'email', 'tel', 'url', 'number', 'textarea'];
  // Phone widgets with a separate country menu: the country comes from the number's prefix.
  const DIAL = {'+1': 'United States', '+30': 'Greece', '+31': 'Netherlands', '+32': 'Belgium', '+33': 'France', '+34': 'Spain',
    '+36': 'Hungary', '+39': 'Italy', '+40': 'Romania', '+41': 'Switzerland', '+43': 'Austria', '+44': 'United Kingdom',
    '+45': 'Denmark', '+46': 'Sweden', '+47': 'Norway', '+48': 'Poland', '+49': 'Germany', '+351': 'Portugal', '+353': 'Ireland',
    '+358': 'Finland', '+373': 'Moldova', '+380': 'Ukraine', '+420': 'Czech Republic', '+421': 'Slovakia', '+972': 'Israel',
    '+971': 'United Arab Emirates', '+91': 'India', '+86': 'China', '+81': 'Japan', '+61': 'Australia', '+55': 'Brazil'};
  const dialOf = phone => Object.keys(DIAL).sort((a, b) => b.length - a.length).find(code => String(phone || '').replace(/\s/g, '').startsWith(code));
  const LEGAL = /\b(i agree|i accept|terms|privacy|consent\w*|acknowledg\w*|certif\w*|affirm\w*|i confirm i have read|i have read and understood)\b/i;
  const clean = text => String(text || '').replace(/\s+/g, ' ').replace(/\*\s*$/, '').trim();
  const norm = text => clean(text).toLowerCase();
  // Audit labels can repeat themselves (label text + aria-label): "First Name First Name" -> "First Name".
  const once = text => clean(text).replace(/^(.+?)\s+\1$/i, '$1');
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
          // The menu as it opened (before typing filters it): for the fill-failure report's snapshot (snapshot.js).
          try { (window.__jobPilottoMenuSnapshots ||= {})[control.dataset.jobpilottoArmed] = window.__jobPilottoSnapshot?.({field: el.id || el.name}); } catch {}
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

  // Put a PDF into the file input whose surroundings match `pattern` (a lone file input takes it when `alone`).
  const attachFile = (file, pattern, alone, skip = null) => {
    const inputs = Array.from(document.querySelectorAll('input[type=file]'));
    const context = el => `${el.id} ${el.name} ${el.getAttribute('aria-label') || ''} ${el.closest('div, fieldset, section')?.textContent || ''}`;
    const input = inputs.find(el => pattern.test(context(el)) && !(skip && skip.test(`${el.id} ${el.name} ${el.getAttribute('aria-label') || ''}`)))
      || (alone && inputs.length === 1 ? inputs[0] : null);
    if (!input || input.files?.length) return false;
    const bytes = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], file.name, {type: file.type || 'application/pdf'}));
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  };
  const attachResume = resume => attachFile(resume, /resume|\bcv\b|lebenslauf/i, true, /cover/i);
  // The approved general cover letter as a file, only into an input that says Cover letter (never a lone input).
  const attachCoverLetter = file => attachFile(file, /cover\s*letter|anschreiben/i, false);

  // Tick every visible terms/privacy/consent box and hand Submit to the user (the extension never submits).
  const tickConsents = () => {
    window.__jobPilottoHandOver?.();
    const ticked = [];
    for (const box of document.querySelectorAll('input[type=checkbox]')) {
      const text = `${questionOf(box)} ${labelOf(box)}`;
      // Sites often hide the real checkbox behind a drawn one: then its label is what's on screen.
      const label = box.labels?.[0] || box.closest('label');
      if (box.checked || !LEGAL.test(text) || !(visible(box) || (label && visible(label)))) continue;
      (visible(box) ? box : label).click();
      if (!box.checked && label && visible(box)) label.click();
      if (box.checked) ticked.push(clean(String(questionOf(box) || labelOf(box)).replace(/\S*(_|\[\])\S*/g, ' ')).slice(0, 90));
    }
    return ticked;
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

  // The page's highlight for fields (one stylesheet, added once, shared by fill.js and review.js): a soft amber ring
  // and glow instead of a hard border or outline. "review": an answer the AI wrote (pulses 3 times, then stays soft);
  // "flash": the field the panel or the app pointed at (pulses, removed after a few seconds).
  const glowStyle = () => {
    if (document.getElementById('jobpilotto-glow-style')) return;
    const style = document.createElement('style');
    style.id = 'jobpilotto-glow-style';
    style.textContent = `
      @keyframes jobpilotto-pulse { 0%, 100% { box-shadow: 0 0 0 2px rgba(245,158,11,.45), 0 0 10px 2px rgba(245,158,11,.18); }
        50% { box-shadow: 0 0 0 3px rgba(245,158,11,.75), 0 0 22px 6px rgba(245,158,11,.35); } }
      .jobpilotto-review { box-shadow: 0 0 0 2px rgba(245,158,11,.45), 0 0 10px 2px rgba(245,158,11,.18) !important;
        animation: jobpilotto-pulse 1.4s ease-in-out 3; transition: box-shadow .3s ease; }
      .jobpilotto-flash { box-shadow: 0 0 0 3px rgba(240,112,20,.8), 0 0 24px 6px rgba(240,112,20,.35) !important;
        animation: jobpilotto-pulse 1s ease-in-out 3; transition: box-shadow .3s ease; }
      @media (prefers-reduced-motion: reduce) { .jobpilotto-review, .jobpilotto-flash { animation: none; } }`;
    document.head.append(style);
  };

  // ---- Live panel: re-checks the page as the user works, so done items disappear and it turns green. ----
  const attention = new Map();  // field id -> label: AI-written answers the user should read
  // Orange border + tag on answers the AI wrote (long text, cover letter, low confidence); cleared when the user edits.
  const markAttention = (field, label) => {
    const el = document.getElementById(field) || document.querySelector(`[name="${CSS.escape(field)}"]`);
    if (!el || attention.has(field)) return;
    const target = isCombo(el) ? comboControl(el) : el;
    // A soft amber glow on the field's own box (no caption): the box is the first of the field and its wrappers that
    // has a border, else the field itself.
    let frame = target;
    for (let box = target, i = 0; box && i < 4; box = box.parentElement, i++)
      if (parseFloat(getComputedStyle(box).borderBottomWidth) > 0) { frame = box; break; }
    const before = {title: el.title};
    glowStyle();
    frame.classList.add('jobpilotto-review');
    el.title = 'Written by AI: read it before submitting';
    el.setAttribute('data-jobpilotto-ai', '');
    attention.set(field, clean(label).slice(0, 120));
    const clear = event => {
      if (!event.isTrusted) return;
      frame.classList.remove('jobpilotto-review');
      el.title = before.title; el.removeAttribute('data-jobpilotto-ai'); attention.delete(field);
      el.removeEventListener('input', clear);
    };
    el.addEventListener('input', clear);
  };

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
    if (!('__jobPilottoGuardActive' in window)) return {error: 'The page helpers did not load; nothing was filled.'};
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
    const letterFileAttached = resume?.coverLetterFile ? attachCoverLetter(resume.coverLetterFile) : false;
    if (letterFileAttached) filled += 1;
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
      todo.push(`Answer: ${once(rowOf[row.field]?.label || clean(row.label).replace(row.field, '')) || row.field}`);
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
    // Upload widgets' own buttons (Attach, Dropbox, Enter manually…) aren't questions: not in the log.
    const trace = after.filter(row => row.field !== 'resume' && row.type !== 'file' && !/^(attach|dropbox|google drive|enter manually)$/i.test(clean(row.label))).map(row => {
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
    for (const item of answers) {
      const row = rowOf[item.field];
      if (!row || contactFields.has(item.field) || row.legal || /your details|standard answer/.test(item.source || '')) continue;
      const long = row.type === 'textarea' || String(item.value || '').length > 80;
      const unsure = item.confidence && item.confidence !== 'high';
      if (long || unsure) markAttention(item.field, row.label || item.question || item.field);
    }
    const letterBox = Array.from(document.querySelectorAll('textarea')).find(el => /cover\s*letter/i.test(`${el.id} ${el.name} ${labelOf(el)}`));
    if (coverLetter && letterBox?.value) markAttention(letterBox.id || letterBox.name, 'Cover letter');
    return summary;
  };
})();

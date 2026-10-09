// Runs in the application page (main world) after browser-submit-guard.js and browser-form-fastpath.js.
// Describes the form (labels, types, options; never your values), fills answers of every field type,
// attaches the CV, and shows what is left in a panel on the page. It never clicks Submit or legal
// checkboxes: the guard blocks both until you unlock them yourself.
// Its helpers come first, each a concern of its own (FILL_FILES in extension/page-files.js): fill-labels.js (names, LEGAL), fill-read.js (the
// reader), fill-menus.js (dropdowns), fill-checks.js (checkboxes, consents), fill-marks.js (the AI glow), shared through window.__jobPilottoFillKit.
(() => {
  if (window.__jobPilottoFillLoaded) return;
  window.__jobPilottoFillLoaded = true;

  const {LEGAL, clean, norm, once, sleep, visible, labelOf, questionOf, radioOps, PROFILE_LABELS, aliasFor, DIAL, dialOf, armCombo,
    pickCheckboxOption, setCheckbox, tickConsents, markAttention} = window.__jobPilottoFillKit;

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

  // answers: [{field, value, question?, confidence?, note?}] merged by the extension (AI + kit).
  window.__jobPilottoExtensionFill = async (all, profile, resume, coverLetter = '', acceptConsents = false) => {
    if (!('__jobPilottoGuardActive' in window)) return {error: 'The page helpers did not load; nothing was filled.'};
    // The AI's likely answers it was not told (use: "propose", worker/src/extension.js): shown to you as proposals, never typed.
    const answers = (all || []).filter(a => a.use !== 'propose'), proposedOf = Object.fromEntries((all || []).filter(a => a.use === 'propose').map(a => [a.field, a]));
    const form = await window.__jobPilottoDescribeForm();
    for (const group of window.__jobPilottoCheckboxQuestions()) {
      form.push({field: `group:${group.question}`, question: group.question, label: group.question, type: 'checkbox-group', options: group.options,
        filled: false, legal: LEGAL.test(group.question)});
    }
    const rowOf = Object.fromEntries(form.map(row => [row.field, row]));
    window.__jobPilottoMarkCategories?.(answers, rowOf);   // the AI's reading, any language: legal never filled (page/categories.js)
    // Kit answers name fields as the job board does (question_123[]); a checkbox group is matched by its question.
    for (const item of answers) {
      if (rowOf[item.field] || !item.question) continue;
      const group = form.find(row => row.type === 'checkbox-group' && norm(row.question) === norm(item.question));
      if (group) item.field = group.field;
    }
    const contact = window.__jobPilottoProfileEntries(form, profile || {});
    const contactFields = new Set(contact.map(entry => entry.field));
    const todo = [], review = [], armed = []; document.querySelectorAll('.job-pilotto-badge').forEach(badge => badge.remove());
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
      else if (row.type === 'radio') ok = item.field.startsWith('aria:') ? radioOps.pickAriaRadio(item.field.slice(5), item.value) : radioOps.pickRadio(item.field.slice(6), item.value);
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
      if (row.type !== 'combobox' || row.filled || row.legal || answered.has(row.field) || !(row.demographic || DEMOGRAPHIC.test(row.label || ''))) continue;
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
    // Controls the form reader above does not set (pressable Yes/No groups, custom dropdowns, date pickers): the generic
    // operators (page/controls.js) get the same answers, act only on a control an answer was matched to, and verify each.
    if (window.__jobPilottoControls) {
      const operated = await window.__jobPilottoControls.fill(answers, {skip: question => LEGAL.test(question)}).catch(() => []);
      for (const result of operated) {
        if (result.ok) filled += 1; else todo.push(`Pick "${result.value}" for: ${result.question}${result.why ? ` (${result.why})` : ''}`);
      }
      // Which kind of control and fingerprint worked or not: no question, no answer.
      window.__jobPilottoOperatedQuestions = operated.map(result => result.question);
      window.__jobPilottoOperated = operated.map(({kind, fp, recipe, ok, why}) => ({kind, fp, recipe: recipe || 0, ok, why: why || ''}));
    }
    // The files (page/upload.js): each upload slot is operated by what it asks for; a miss is reported by fingerprint like any control's.
    const uploads = await window.__jobPilottoUpload.fill({resume: resume?.data ? resume : null, coverLetter: resume?.coverLetterFile || null}).catch(() => []);
    const resumeAttached = uploads.some(item => item.meaning === 'resume' && item.ok);
    const letterFileAttached = uploads.some(item => item.meaning === 'cover_letter' && item.ok);
    window.__jobPilottoOperated = [...(window.__jobPilottoOperated || []), ...uploads.filter(item => item.ok !== undefined)
      .map(({fp, recipe, ok, why}) => ({kind: 'upload', fp, recipe: recipe || 0, ok, why: why || ''}))];
    // Wordings nobody knew (no text of yours: the slot's own title), for the service to give a meaning once.
    window.__jobPilottoUnknownUploads = uploads.filter(item => item.why === 'wording unknown' && item.label).map(item => item.label);
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
      // The audit lists each radio option on its own: one row per group instead, named and required as the form described it.
      if (row.type === 'radio') {
        const el = document.getElementById(row.field) || document.querySelector(`input[type=radio][name="${CSS.escape(row.field)}"]`);
        if (!el?.name) return [row];
        const key = `radio:${el.name}`;
        if (seenGroups.has(key)) return [];
        seenGroups.add(key);
        const radios = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`));
        return [{...row, field: key, label: rowOf[key]?.label || questionOf(el) || row.label, filled: radios.some(r => r.checked),
          required: row.required || !!rowOf[key]?.required}];
      }
      const q = row.type === 'checkbox' && groupOf.get(row.field);
      if (!q) return [row];
      const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')).filter(b => questionOf(b) === q);
      if (boxes.length < 2) return [{...row, label: q}];
      if (seenGroups.has(q)) return [];
      seenGroups.add(q);
      return [{...row, field: `group:${q}`, label: q, filled: boxes.some(b => b.checked), required: boxes.some(b => b.required) || row.required}];
    });
    // Required questions the page shows that nothing above read (page/coverage.js): a layout the reader doesn't know. Each is
    // listed for you, counted as required, and traced as a reading failure, so it is reported (with its HTML) and learned.
    after.push(...radioOps.ariaRows(form));   // not in the audit (no <input>): listed, and counted when picked
    const unread = [];
    if (window.__jobPilottoCoverage) {
      // Read = asked about: the described fields and the widgets an operator answered. Not the audit's rows: a field can be on
      // the page (and in the audit) without its question ever having been asked.
      const read = [...form.map(row => row.label), ...(window.__jobPilottoOperatedQuestions || [])];
      for (const item of window.__jobPilottoCoverage.unread(document, read, visible)) {
        item.area.setAttribute('data-jobpilotto-unread', item.question);
        unread.push(item);
        const same = after.find(row => norm(row.label) === norm(item.question));
        if (same) Object.assign(same, {required: true, unread: true});
        else after.push({field: `unread:${item.question}`, label: item.question, type: item.kinds[0] || '', required: true,
          filled: window.__jobPilottoCoverage.answered(item.area), legal: LEGAL.test(item.question), unread: true});
      }
    }
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
    // A value we put in that the person then changes by hand is a correction: the label is kept (never the value) so the product learns
    // which questions it fills wrongly. The background drains window.__jobPilottoCorrections (extension/background.js reportTabs).
    window.__jobPilottoCorrections = window.__jobPilottoCorrections || [];
    const watchCorrection = (field, label) => {
      const el = document.getElementById(field) || document.querySelector(`[name="${CSS.escape(field)}"]`);
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const once = event => {
        if (!event.isTrusted) return;
        el.removeEventListener('input', once); el.removeEventListener('change', once);
        if (window.__jobPilottoCorrections.length < 40) window.__jobPilottoCorrections.push(clean(label).slice(0, 100));
      };
      el.addEventListener('input', once); el.addEventListener('change', once);
    };
    // Every field the fill set carries a mark, so the panel tells at Submit what you answered yourself (extension/review.js).
    const markFilled = field => {
      const name = String(field);
      const els = name.startsWith('radio:') ? document.querySelectorAll(`input[type=radio][name="${CSS.escape(name.slice(6))}"]`)
        : name.startsWith('group:') ? Array.from(document.querySelectorAll('input[type=checkbox]')).filter(b => questionOf(b) === name.slice(6))
        : [document.getElementById(name) || document.querySelector(`[name="${CSS.escape(name)}"]`)];
      for (const el of els) el?.setAttribute('data-jobpilotto-filled', '');
    };
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
      else if (row.unread && !row.filled) reason = 'question on the page not read';
      else if (!row.filled && proposedOf[row.field]) reason = 'proposed for you to confirm';
      else if (!row.filled && armedFields.has(row.field)) { outcome = 'left'; reason = 'dropdown that opens only on a real click'; }
      // The question read as one of its own choices (or nothing): the page's title wasn't found, so no answer could be right.
      else if (!row.filled && !answer && (!label || (rowOf[row.field]?.options || []).some(o => norm(o) === norm(label)))) reason = 'question text not found on the page';
      else if (!row.filled && !answer && !contactFields.has(row.field)) reason = 'no answer in the kit, Profile or your details';
      else if (!row.filled) reason = 'answer given, but the field did not take it';
      if (outcome === 'filled' && source && row.type !== 'file') watchCorrection(row.field, label);
      if (outcome === 'filled' && source) markFilled(row.field); else window.__jobPilottoMarkProposal?.({...row, options: rowOf[row.field]?.options || row.options}, answer || proposedOf[row.field], (PROFILE_LABELS.find(([, pattern]) => pattern.test(label)) || [])[0] || aliasFor(label)?.key || '');   // page/propose.js: what the app's row proposes
      return {label: label.slice(0, 120), required: !!row.required, type: rowOf[row.field]?.type || '', source, outcome, reason,
        alias: (window.__jobPilottoAliasUsed || {})[row.field] || '',
        low: answer && answer.confidence && answer.confidence !== 'high' ? (answer.note || 'low confidence') : ''};
    });
    trace.push({label: 'CV', required: true, type: 'file', source: 'your CV', outcome: resumeAttached ? 'filled' : 'left',
      reason: resumeAttached ? '' : 'no CV in the app'});
    const summary = {filled, unfilledRequired, contact: contact.length, resumeAttached, trace, operated: window.__jobPilottoOperated || [], unknownUploads: window.__jobPilottoUnknownUploads || [], todo: [...new Set([...todo, ...review, ...legal])].slice(0, 25)};
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

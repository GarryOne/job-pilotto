// Deterministic helpers injected into application pages. No network calls, submit actions,
// checkbox clicks, or legal attestations. Return labels/status only, never applicant values.
(() => {
  const forbidden = /submit|apply now|send application|privacy|terms|consent|acknowledg|i agree|i accept/i;
  const label = element => {
    const texts = [element.getAttribute('aria-label'), element.name, element.id,
      ...Array.from(element.labels || [], item => item.textContent)];
    return texts.filter(Boolean).join(' ').trim();
  };
  const visible = element => !!(element.getClientRects().length &&
    getComputedStyle(element).visibility !== 'hidden');
  const writable = element => {
    if (!element || !visible(element) || element.disabled || element.readOnly) return false;
    if (forbidden.test(label(element))) return false;
    if (element.matches('textarea, select')) return true;
    return element.matches('input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"]');
  };
  const byField = field => {
    const elements = Array.from(document.querySelectorAll('input, textarea, select'));
    return elements.find(el => el.id === field || el.name === field);
  };
  // react-select (every Greenhouse dropdown) renders a text input that is only its search box:
  // setting its value selects nothing, and the chosen option lives in the container instead.
  const isCombo = element => element.getAttribute('role') === 'combobox';
  const comboFilled = element => !!(element.closest('[class*=select__container]') ||
    element.closest('[class*=container]'))?.querySelector('[class*=single-value], [class*=multi-value]');
  // Step timer for the Agent Runs record: helpers stamp themselves; agents add named steps
  // ("dropdowns", "resume") inside a JS call they already make. Times only, never values.
  window.__jobPilottoSteps = window.__jobPilottoSteps || [];
  window.__jobPilottoStep = name => {
    window.__jobPilottoSteps.push({name: String(name).slice(0, 40), at: new Date().toISOString()});
    return window.__jobPilottoSteps.length;
  };
  window.__jobPilottoFillKnownFields = entries => {
    // The Chrome extension turns the guard off on purpose (it never clicks Submit itself).
    if (!window.__jobPilottoGuardActive && !window.__jobPilottoNoGuard) return {error: 'submit guard is inactive'};
    window.__jobPilottoStep('fill known fields');
    const filled = [], skipped = [];
    for (const item of entries) {
      const key = String(item.field || '');
      const element = byField(key);
      if (!element || !writable(element) || typeof item.value !== 'string') {
        skipped.push(key);
        continue;
      }
      if (isCombo(element)) {
        skipped.push(`${key} (combobox: pick its option instead)`);
        continue;
      }
      if (element.tagName === 'SELECT') {
        const option = Array.from(element.options).find(o => o.value === item.value || o.text.trim() === item.value);
        if (!option) { skipped.push(key); continue; }
        element.value = option.value;
      } else {
        const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, item.value);
      }
      element.dispatchEvent(new Event('input', {bubbles: true}));
      element.dispatchEvent(new Event('change', {bubbles: true}));
      filled.push(key);
    }
    // Then leave each one the way a person does (focus, then blur). Sites hang their look on those events: a floating label that moves up
    // once the field has been left with a value sat on top of the filled text (3 Oct 2026, consultandpepper.com).
    for (const key of filled) {
      const element = byField(String(key));
      if (!element || element.tagName === 'SELECT') continue;
      try { element.focus({preventScroll: true}); element.blur(); } catch { /* not focusable */ }
    }
    return {filled, skipped};
  };
  // Greenhouse removes the file input once a file is attached and shows its name instead, so the
  // resume counts as attached when its section shows a document filename.
  // The * of an upload slot can sit in a label above the box ("* CV and diplomas"): look a few levels up, never into a box that holds text fields.
  const starred = box => {
    for (let up = box, i = 0; up && i < 3; up = up.parentElement, i++) {
      if (up.querySelector('input:not([type=file]):not([type=hidden]), textarea, select')) return false;
      if (/\*/.test(up.textContent || '')) return true;
    }
    return false;
  };
  const resumeRow = () => {
    const heading = Array.from(document.querySelectorAll('label, legend, h2, h3, h4, span, div'))
      .find(el => !el.children?.length && /^\s*(resume|cv|resume\s*\/\s*cv)\b/i.test(el.textContent || ''))
      // An upload box that names the CV in a few words ("Upload a CV", "Charger un CV"): SuccessFactors draws it as a + button, no input yet.
      || Array.from(document.querySelectorAll('span, div, label')).find(el => !el.children?.length && el.getClientRects().length &&
        (el.textContent || '').trim().length < 40 && /\b(resume|cv|lebenslauf)\b/i.test(el.textContent) && !/cover/i.test(el.textContent));
    if (!heading) return null;
    let box = heading;
    for (let i = 0; i < 4 && box.parentElement; i++) box = box.parentElement;
    const fileInput = box.querySelector('input[type=file]');
    // The words a person sees: a script or hidden text in the box can mention "x.doc" without any file being attached.
    const named = /\S+\.(pdf|docx?|rtf|txt|odt)\b/i.test(box.innerText || '');
    return {field: 'resume', label: 'Resume/CV', type: 'file', required: /\*/.test(heading.textContent || '') || starred(box),
      legal: false, filled: named || !!fileInput?.files?.length};
  };
  window.__jobPilottoAuditVisibleFields = () => {
    window.__jobPilottoStep('audit');
    const rows = Array.from(document.querySelectorAll('input, textarea, select'))
      // aria-hidden inputs are react-select's hidden "required" helpers, not fields.
      .filter(el => visible(el) && !el.disabled && el.getAttribute('aria-hidden') !== 'true'
        && !['hidden', 'submit', 'button', 'reset', 'search'].includes(el.type))
      .map(el => ({field: el.id || el.name || label(el), label: label(el),
        type: isCombo(el) ? 'combobox' : el.type || el.tagName.toLowerCase(),
        required: !!(el.required || el.getAttribute('aria-required') === 'true'),
        legal: forbidden.test(label(el)), filled: el.type === 'file' ? !!el.files?.length :
          isCombo(el) ? comboFilled(el) :
          ['checkbox', 'radio'].includes(el.type) ? !!el.checked : !!String(el.value || '').trim()}));
    const resume = resumeRow();
    if (!resume) return rows;
    return [...rows.filter(r => !(r.type === 'file' && /resume|cv/i.test(`${r.field} ${r.label}`))), resume];
  };
  // Read-only: text and viewport centre of every option in the currently open dropdown menu, so a
  // click lands on live coordinates instead of a position eyeballed from an older screenshot.
  window.__jobPilottoOptionPositions = () => Array.from(document.querySelectorAll('[class*="option"]'))
    .filter(el => el.offsetParent !== null && el.children.length === 0)
    .map(el => {
      const box = el.getBoundingClientRect();
      return {text: el.textContent.trim().slice(0, 80), x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2), onScreen: box.top >= 0 && box.bottom <= innerHeight};
    });
  // Pick the option whose text EXACTLY equals `wanted` in the open dropdown menu (case/space
  // insensitive). Typing + Return picks the first partial match ("Male" -> "Female", "4" -> "0"),
  // so use this instead. Returns the live coordinates too, for a trusted click if a site ignores
  // a JS click; verify with the audit afterwards.
  window.__jobPilottoClickOption = wanted => {
    const norm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const options = Array.from(document.querySelectorAll('[class*="option"]'))
      .filter(el => el.offsetParent !== null && !el.children?.length);
    const exact = options.filter(el => norm(el.textContent) === norm(wanted));
    if (exact.length !== 1) {
      return {ok: false, why: exact.length ? 'ambiguous' : 'no exact match',
        options: options.map(el => el.textContent.trim().slice(0, 60)).slice(0, 40)};
    }
    const box = exact[0].getBoundingClientRect();
    exact[0].click();
    return {ok: true, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2)};
  };
})();

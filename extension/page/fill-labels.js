// The form filler's reading helpers (split from page/fill.js, 9 Oct 2026): a field's name, the question a radio group or checkbox belongs to,
// whether it is required, a combobox's control and value, the legal-words floor (LEGAL) and the native/ARIA radio operators (page/radios.js).
// Injected first of the fill files (FILL_FILES in extension/page-files.js); shared through window.__jobPilottoFillKit, read by fill-read.js,
// fill-menus.js, fill-checks.js, fill-marks.js and fill.js. Guarded by worker/test/fill-learning.test.js (plants), extension-files.test.js.
(() => {
  if (window.__jobPilottoFillLabelsLoaded) return;
  window.__jobPilottoFillLabelsLoaded = true;

  const LEGAL = /\b(i agree|i accept|terms|privacy|consent\w*|acknowledg\w*|certif\w*|affirm\w*|i confirm i have read|i have read and understood)\b/i;
  const clean = text => window.__jobPilottoRequired.clean(text, {leading: false});   // a group's name keeps its leading "*": the radios read it with `has`
  const norm = text => clean(text).toLowerCase();
  // Audit labels can repeat themselves (label text + aria-label): "First Name First Name" -> "First Name".
  const once = text => clean(text).replace(/^(.+?)\s+\1$/i, '$1');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  // A field's own title when nothing ties it to the field (Ashby's location: <label for="…"> naming no element): the one label
  // tied to no control in the field's entry, within three levels; never two (that is a group's title, not this field's).
  const looseLabel = el => {
    for (let up = el.parentElement, i = 0; up && i < 3; up = up.parentElement, i++) {
      const loose = Array.from(up.querySelectorAll('label')).filter(l => !l.control && !l.querySelector('input, select, textarea'));
      if (loose.length === 1) return loose[0].textContent;
      if (loose.length > 1) return '';
    }
    return '';
  };
  // A field's question when it sits in a sibling block, not a <label> (Lever: <div class="application-label"> beside the textarea, 11 Oct 2026):
  // within three levels, the one label/title-like block that holds no control, is not the field's own ancestor and comes before it; never two,
  // and only for a field alone in its entry (a text box beside pressable choices is that group's "other", not the title's answer).
  const TITLE_BLOCK = '[class*=label], [class*=Label], [class*=title], [class*=Title], [class*=question-text], legend';
  const blockTitle = el => {
    const ACTIVE = 'input:not([type=hidden]), select, textarea, button, [tabindex], [role=radio], [role=checkbox], [role=button], [role=combobox]';
    for (let up = el.parentElement, i = 0; up && i < 3; up = up.parentElement, i++) {
      if (Array.from(up.querySelectorAll(ACTIVE)).some(other => other !== el && !el.contains(other))) return '';
      const found = Array.from(up.querySelectorAll(TITLE_BLOCK)).filter(b => !b.contains(el) && !b.querySelector('input, select, textarea, button') &&
        clean(b.textContent) && b.textContent.length <= 200 && (b.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      const innermost = found.filter(b => !found.some(o => o !== b && b.contains(o)));
      if (innermost.length === 1) return innermost[0].textContent;
      if (innermost.length > 1) return '';
    }
    return '';
  };
  const labelOf = el => {
    const own = Array.from(el.labels || [], l => l.textContent).join(' ') || el.getAttribute('aria-label');
    const byId = el.getAttribute('aria-labelledby');
    const labelled = byId && byId.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
    return clean(own || labelled || looseLabel(el) || el.getAttribute('placeholder') || (el.type !== 'hidden' && blockTitle(el)) || (el.type !== 'hidden' && window.__jobPilottoLabelBefore?.(el)) || el.name || el.id);
  };
  // The question a radio group or checkbox belongs to: its fieldset legend or group label.
  // A fieldset's title: its <legend>, or (Ashby) a <label> whose `for` points at no control. Required when the title says so:
  // a trailing "*", a "required" class, or a "*" drawn by CSS (Ashby marks its radio groups only that way, no attribute).
  const fieldsetTitle = set => set && (set.querySelector('legend') ||
    Array.from(set.querySelectorAll('label')).find(l => !l.control && !l.querySelector('input, select, textarea')));
  const titleRequired = title => !!title && (window.__jobPilottoRequired.has(title.textContent) || /required/i.test(String(title.className || '')) ||
    String(getComputedStyle(title, '::after').content || '').includes('*'));
  const questionOf = el => clean(fieldsetTitle(el.closest('fieldset'))?.textContent ||
    (['radio', 'checkbox'].includes(el.type) ? window.__jobPilottoRequired.rowTitle(el)?.textContent : '') ||
    el.closest('[role=radiogroup], [role=group]')?.getAttribute('aria-label') ||
    el.closest('[role=radiogroup], [role=group]')?.querySelector('label, legend, span')?.textContent || '');
  const isCombo = el => el.getAttribute('role') === 'combobox';
  const comboControl = el => el.closest('[class*=control]') || el;
  const comboValue = el => (el.closest('[class*=select__container]') || el.closest('[class*=container]'))?.querySelector('[class*=single-value], [class*=multi-value]') ||   // react-select's chip,
    (() => { for (let b = el.parentElement, i = 0; b && i < 4 && b.querySelectorAll('input:not([type=hidden]), select, textarea').length <= 1; b = b.parentElement, i++) { const h = [...b.querySelectorAll('input[type=hidden][id]')].find(x => x.value && document.querySelector(`label[for="${CSS.escape(x.id)}"]`)); if (h) return h; } return null; })();   // else a labelled hidden input holding it (review.js comboFilled)
  const radioOps = window.__jobPilottoRadios({clean, norm, labelOf, questionOf, LEGAL, visible});   // page/radios.js, injected first
  window.__jobPilottoFillKit = {LEGAL, clean, norm, once, sleep, visible, looseLabel, labelOf, fieldsetTitle, titleRequired, questionOf,
    isCombo, comboControl, comboValue, radioOps};
})();

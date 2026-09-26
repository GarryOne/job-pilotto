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
  window.__jobPilottoFillKnownFields = entries => {
    if (!window.__jobPilottoGuardActive) return {error: 'submit guard is inactive'};
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
    return {filled, skipped};
  };
  window.__jobPilottoAuditVisibleFields = () => Array.from(
    document.querySelectorAll('input, textarea, select'))
    .filter(el => visible(el) && !el.disabled && !['hidden', 'submit', 'button', 'reset', 'search'].includes(el.type))
    .map(el => ({field: el.id || el.name || label(el), label: label(el),
      type: isCombo(el) ? 'combobox' : el.type || el.tagName.toLowerCase(),
      required: !!(el.required || el.getAttribute('aria-required') === 'true'),
      legal: forbidden.test(label(el)), filled: el.type === 'file' ? !!el.files?.length :
        isCombo(el) ? comboFilled(el) :
        ['checkbox', 'radio'].includes(el.type) ? !!el.checked : !!String(el.value || '').trim()}));
  // Read-only: text and viewport centre of every option in the currently open dropdown menu, so a
  // click lands on live coordinates instead of a position eyeballed from an older screenshot.
  window.__jobPilottoOptionPositions = () => Array.from(document.querySelectorAll('[class*="option"]'))
    .filter(el => el.offsetParent !== null && el.children.length === 0)
    .map(el => {
      const box = el.getBoundingClientRect();
      return {text: el.textContent.trim().slice(0, 80), x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2), onScreen: box.top >= 0 && box.bottom <= innerHeight};
    });
})();

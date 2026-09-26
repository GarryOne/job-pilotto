// Read-only snapshot of an application form: each visible question with its current answer.
// Run in the job's tab by tools/chrome-form-snapshot.js (via tools/wait-and-mark-applied.sh) while
// the form is open; the last snapshot before the confirmation page is what was submitted. It never
// changes the page. The result is a JSON string: {url, at, fields: [{label, value, type, required}]}.
(() => {
  const clean = text => (text || '').replace(/\s+/g, ' ').replace(/\*\s*$/, '').trim();
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const labelOf = el => {
    const own = Array.from(el.labels || [], l => l.textContent).join(' ') || el.getAttribute('aria-label');
    const byId = el.getAttribute('aria-labelledby');
    const labelled = byId && byId.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
    const legend = el.closest('fieldset')?.querySelector('legend')?.textContent;
    return clean(own || labelled || legend || el.getAttribute('placeholder') || el.name || el.id);
  };
  const fields = [], seen = new Set();
  const add = (el, label, value, type) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    fields.push({label: label.slice(0, 300), value: String(value ?? '').slice(0, 5000), type,
                 required: !!(el.required || el.getAttribute('aria-required') === 'true' ||
                              /\*\s*$/.test(Array.from(el.labels || [], l => l.textContent).join(' ')))});
  };
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const type = (el.type || el.tagName).toLowerCase();
    if (['hidden', 'submit', 'button', 'search', 'password'].includes(type)) continue;
    if (type === 'radio') {
      if (!el.checked) continue;
      const group = el.closest('fieldset')?.querySelector('legend')?.textContent || el.name;
      add(el, clean(group), labelOf(el), 'radio');
    } else if (type === 'checkbox') {
      const group = el.closest('fieldset')?.querySelector('legend')?.textContent;
      if (group) {
        const checked = Array.from(el.closest('fieldset').querySelectorAll('input[type=checkbox]:checked'), labelOf);
        add(el, clean(group), checked.join('; '), 'checkboxes');
      } else {
        add(el, labelOf(el), el.checked ? 'yes' : 'no', 'checkbox');
      }
    } else if (type === 'file') {
      add(el, labelOf(el), Array.from(el.files || [], f => f.name).join('; '), 'file');
    } else if (el.getAttribute('role') === 'combobox') {
      // react-select (Greenhouse and others): the chosen option lives in the container, not the input.
      const box = el.closest('[class*=select__container]') || el.closest('[class*=container]');
      const chosen = box ? Array.from(box.querySelectorAll('[class*=single-value], [class*=multi-value__label]'),
                                      n => clean(n.textContent)) : [];
      add(el, labelOf(el), chosen.join('; '), 'select');
    } else if (el.tagName === 'SELECT') {
      if (!visible(el)) continue;
      add(el, labelOf(el), Array.from(el.selectedOptions, o => clean(o.text)).join('; '), 'select');
    } else {
      if (!visible(el)) continue;
      add(el, labelOf(el), el.value, el.tagName === 'TEXTAREA' ? 'textarea' : 'text');
    }
  }
  return JSON.stringify({url: location.href, at: new Date().toISOString(), fields});
})();

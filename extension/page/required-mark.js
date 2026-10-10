// The required mark, one rule for every reader: a "*" (also ∗ ＊) leading a label, or trailing it with an optional ":" or "." after it
// ("Name *", "Anrede*:", "Nom* :"). Structure only: no word, no language, no site. The panel (review.js), the fill (page/fill-labels.js),
// the coverage (page/coverage.js), the radio groups (page/radios.js) and the proposer (page/propose.js) all ask it, so they cannot disagree.
// Injected in both worlds (page-files.js, and the panel's list in background.js). Guarded by worker/test/required-mark.test.js.
(() => {
  if (window.__jobPilottoRequired) return;
  const STAR = '[*\\u2217\\uFF0A]';
  const TRAILING = new RegExp(`\\s*${STAR}+\\s*[:\\uFF1A.]?\\s*$`);
  const LEADING = new RegExp(`^\\s*${STAR}+\\s*`);
  const text = value => String(value || '').replace(/\s+/g, ' ').trim();
  // Does this label text carry the mark?
  const has = value => { const t = text(value); return TRAILING.test(t) || LEADING.test(t); };
  // The label's words without the mark and the colon after it.
  // `leading: false` keeps a leading mark (the fill reads a group's name with it, then asks `has`).
  const clean = (value, {leading = true} = {}) => text(text(value).replace(leading ? LEADING : /^$/, '').replace(TRAILING, '').replace(/\s*[:\uFF1A]$/, ''));
  // The title of a radio/checkbox group that has no fieldset: the row it sits in (table row, form row, definition list) names it in a
  // cell or label beside it that holds no control and is not one option's own label. Structure only; the first such cell wins.
  const ROW = 'tr, li, dl, [class*=row], [class*=Row], [class*=field], [class*=Field], [class*=form-group], [class*=question]';
  const rowTitle = el => {
    const row = el.closest?.(ROW);
    if (!row || row.closest('fieldset')) return null;
    const optionLabels = new Set(Array.from(row.querySelectorAll('input[type=radio], input[type=checkbox]')).flatMap(box => [box.closest('label'), ...(box.labels || [])]));
    const cells = Array.from(row.querySelectorAll('th, td, dt, legend, label, [class*=label], [class*=Label], [class*=title]'));
    return cells.find(cell => !optionLabels.has(cell) && !cell.querySelector('input, select, textarea, button') && !cell.contains(el) && text(cell.textContent) &&
      !Array.from(cell.querySelectorAll('label')).some(label => optionLabels.has(label))) || null;
  };
  // An independent count for the learning loop (no personal data, a number only): how many short label-like texts on the page carry a "*"
  // anywhere, except a legend sentence ("Mit * markierte Felder…": the star between two words). It does not use `has`, so when the rule above
  // misses a layout the page still shows starred > required on /admin/insights and /admin/applying, and a recorded page can be added.
  const LEGEND = new RegExp(`\\S\\s+${STAR}\\s+\\S`);
  const starred = doc => {
    let n = 0;
    for (const el of doc.querySelectorAll('label, legend, th, td, dt, span, div, p, b, strong, em, i, abbr')) {
      if (el.closest('#jobpilotto-review-host, .job-pilotto-badge, [id^=jobpilotto]')) continue;
      const t = text(el.textContent);
      if (t.length > 80 || !new RegExp(STAR).test(t) || !/\p{L}/u.test(t) || LEGEND.test(t)) continue;
      if (Array.from(el.children).some(child => { const c = text(child.textContent); return c.length <= 80 && new RegExp(STAR).test(c) && /\p{L}/u.test(c) && !LEGEND.test(c) && child.matches('label, legend, th, td, dt, span, div, p, b, strong, em, i, abbr'); })) continue;   // the innermost one only
      n++;
      if (n >= 200) break;
    }
    return n;
  };
  window.__jobPilottoRequired = {has, clean, rowTitle, starred};
})();

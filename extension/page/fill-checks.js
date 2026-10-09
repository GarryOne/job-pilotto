// The form filler's checkboxes (split from page/fill.js, 9 Oct 2026): one box set to yes/no, the option of a checkbox group that is one
// question, and the consents ticked only when you allowed it (never otherwise: the LEGAL floor). Needs page/fill-labels.js first.
// Guarded by desktop/test/fill-categories.test.js.
(() => {
  if (window.__jobPilottoFillChecksLoaded) return;
  window.__jobPilottoFillChecksLoaded = true;
  const {LEGAL, clean, norm, visible, labelOf, questionOf} = window.__jobPilottoFillKit;

  // A group of checkboxes that is one question ("How did you hear about us?": LinkedIn / Careers website / …): tick the option whose label best matches the answer (exact, then contained either way, then shared words).
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

  const setCheckbox = (field, answer) => {
    const box = document.getElementById(field) || document.querySelector(`input[type=checkbox][name="${CSS.escape(field)}"]`);
    if (!box || LEGAL.test(`${questionOf(box)} ${labelOf(box)}`)) return false;
    const want = /^(checked|yes|true)$/i.test(answer);
    if (box.checked !== want) box.click();
    return box.checked === want;
  };

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
  Object.assign(window.__jobPilottoFillKit, {pickCheckboxOption, setCheckbox, tickConsents});
})();

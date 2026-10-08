// Runs in the application page (main world) before fill.js. Two things for the app's "Needs your attention" rows (owner, 8 Oct 2026:
// the proposed answers were lost when Apply moved from Claude to the extension):
//  - mark(): a field the fill left empty carries what the fill proposed for it (data-jobpilotto-suggested: a kit, Profile or Claude
//    answer the field did not take, a dropdown that needs your click) or the contact detail it asks for (data-jobpilotto-wants: phone…).
//    The panel (review.js) reads these marks and reports them with what is left.
//  - "Use" in the app: the panel passes it to the worker (fill-flow.js), which calls __jobPilottoFillOne(label, value) here: the field
//    with that label is filled through the extension's own fill (__jobPilottoExtensionFill), never by the panel.
(() => {
  if (window.__jobPilottoProposeLoaded) return;
  window.__jobPilottoProposeLoaded = true;
  const clean = text => String(text || '').replace(/\s+/g, ' ').replace(/\*\s*$/, '').trim().toLowerCase();
  const elOf = field => (String(field).startsWith('radio:') ? document.querySelector(`[name="${CSS.escape(String(field).slice(6))}"]`)
    : document.getElementById(field) || document.querySelector(`[name="${CSS.escape(String(field))}"]`));

  window.__jobPilottoMarkProposal = (row, answer, key) => {
    const el = elOf(row.field);
    if (!el || row.filled || row.legal) return;
    if (row.options?.length) el.dataset.jobpilottoOptions = JSON.stringify(row.options.slice(0, 60));   // a select's choices: the app proposes one of them
    if (answer?.value) el.dataset.jobpilottoSuggested = String(answer.value).split(' || ')[0].slice(0, 200);
    else if (key) el.dataset.jobpilottoWants = key;
  };

  // A menu opened by your click had no choice matching the answer (fill.js armCombo): the text typed to filter it goes, so the box
  // is not left holding a word the form doesn't offer ("Monsieur" in a Madam/Sir menu, 8 Oct 2026); the choices it showed are kept for
  // the app, which proposes the one that means the same.
  window.__jobPilottoMenuMissed = (el, shown = []) => {
    if (el?.tagName === 'INPUT') {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '');
      el.dispatchEvent(new Event('input', {bubbles: true}));
    }
    if (el && shown.length) el.dataset.jobpilottoOptions = JSON.stringify(shown.slice(0, 60));
  };
  // One field by its label, through the extension's fill (the worker calls this for "Use" in the app: extension/fill-flow.js). → {ok}
  window.__jobPilottoFillOne = async (label, value) => {
    try {
      const row = ((await window.__jobPilottoDescribeForm?.()) || []).find(item => clean(item.label) === clean(label));
      if (!row || !value || !window.__jobPilottoExtensionFill) return {ok: false};
      const result = await window.__jobPilottoExtensionFill([{field: row.field, value: String(value), source: 'you, from Job Pilotto'}], {}, null, '', false);
      const ok = !result?.error && (result?.filled || 0) > 0;
      if (ok) delete elOf(row.field)?.dataset.jobpilottoSuggested;
      return {ok};
    } catch { return {ok: false}; }
  };
})();

// Radio questions, read as one choice field each and answered by the option whose name is the answer. Two shapes:
//   - native: <input type=radio>, grouped by name (the field "radio:<name>"; read by page/fill.js describeForm);
//   - ARIA: role=radiogroup > role=radio that are not inputs (SuccessFactors, Workday, React kits; the field "aria:<id>"). The question and
//     each option go by their accessible name: aria-label, else the elements aria-labelledby names, else the text (the words often live in
//     another element). 9 Oct 2026, live: 9 required questions of a SuccessFactors form were only "question on the page not read".
// Injected before page/fill.js (extension/flow.js), which passes its helpers in. Never picks a legal option (LEGAL, the fill's own floor).
// Shape test: desktop/test/page-radios.test.js.
(() => {
  window.__jobPilottoRadios = ({clean, norm, labelOf, questionOf, LEGAL, visible}) => {
    const nameOf = el => clean(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => (id && document.getElementById(id)?.textContent) || '').join(' ') || el.textContent || '');
    // The one option whose name is the answer: the same words, else the only one that starts with or contains them.
    const optionFor = (options, answer, name) => {
      const want = norm(answer);
      const named = options.map(option => ({option, n: norm(name(option))}));
      const one = list => (list.length === 1 ? list[0].option : null);
      return named.find(item => item.n === want)?.option || one(named.filter(item => item.n.startsWith(want))) || one(named.filter(item => item.n.includes(want)));
    };
    const pickRadio = (name, answer) => {
      const match = optionFor(Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)), answer, labelOf);
      if (!match || LEGAL.test(`${questionOf(match)} ${labelOf(match)}`)) return false;
      if (!match.checked) match.click();
      return match.checked;
    };
    const groupOf = key => document.getElementById(key) || document.querySelector(`[data-jobpilotto-group="${CSS.escape(key)}"]`);
    const radiosOf = group => Array.from(group?.querySelectorAll('[role=radio]') || []).filter(radio => radio.tagName !== 'INPUT');
    const checked = radios => radios.some(radio => radio.getAttribute('aria-checked') === 'true');
    const pickAriaRadio = (key, answer) => {
      const group = groupOf(key);
      const match = group && optionFor(radiosOf(group), answer, nameOf);
      if (!match || LEGAL.test(`${nameOf(group)} ${nameOf(match)}`)) return false;
      if (match.getAttribute('aria-checked') !== 'true') match.click();
      return match.getAttribute('aria-checked') === 'true';
    };
    // Every visible ARIA radio group as a field (a group gets a key it keeps for the fill that follows).
    const ariaFields = () => Array.from(document.querySelectorAll('[role=radiogroup]')).flatMap(group => {
      const radios = radiosOf(group).filter(visible);
      if (radios.length < 2) return [];
      if (!group.id && !group.dataset.jobpilottoGroup) group.dataset.jobpilottoGroup = `g${document.querySelectorAll('[data-jobpilotto-group]').length + 1}`;
      const raw = String(nameOf(group) || questionOf(radios[0]) || '');
      const question = clean(raw.replace(/^\s*\*\s*/, ''));
      return [{field: `aria:${group.id || group.dataset.jobpilottoGroup}`, label: question, type: 'radio',
        required: /^\s*\*/.test(raw) || group.getAttribute('aria-required') === 'true' || radios.some(radio => radio.getAttribute('aria-required') === 'true'),
        options: radios.map(nameOf).filter(Boolean), filled: checked(radios), legal: LEGAL.test(question)}];
    });
    // The described ARIA fields as audit rows (the audit reads inputs only), with their state now.
    const ariaRows = form => form.filter(row => String(row.field).startsWith('aria:'))
      .map(row => ({...row, filled: checked(radiosOf(groupOf(row.field.slice(5))))}));
    return {nameOf, pickRadio, pickAriaRadio, ariaFields, ariaRows};
  };
})();

// Radio questions, read as one choice field each and answered by the option whose name is the answer. Two shapes:
//   - native: <input type=radio>, grouped by name (the field "radio:<name>"; read by page/fill.js describeForm);
//   - ARIA: role=radiogroup > role=radio that are not inputs (SuccessFactors, Workday, React kits; the field "aria:<id>"). The question and
//     each option go by their accessible name: aria-label, else the elements aria-labelledby names, else the text (the words often live in
//     another element). 9 Oct 2026, live: 9 required questions of a SuccessFactors form were only "question on the page not read".
//   - pressable buttons: two or more button[aria-pressed] under one parent (Ashby's Yes/No, size pickers), the title in a label above; the same
//     field "aria:<id>", found by structure and never by the words Yes/No (6 Oct 2026, OpenAI and Colonist: 3 required Ashby questions "not read").
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
    // The options of a group: its role=radio elements, else (a pressable-button group) its aria-pressed buttons.
    const pressables = group => Array.from(group?.querySelectorAll('button[aria-pressed]') || []).filter(button => button.getAttribute('role') !== 'radio');
    const radiosOf = group => {
      const radios = Array.from(group?.querySelectorAll('[role=radio]') || []).filter(radio => radio.tagName !== 'INPUT');
      return radios.length ? radios : pressables(group);
    };
    const isOn = option => option.getAttribute('aria-checked') === 'true' || option.getAttribute('aria-pressed') === 'true';
    const checked = radios => radios.some(isOn);
    const pickAriaRadio = (key, answer) => {
      const group = groupOf(key);
      const match = group && optionFor(radiosOf(group), answer, nameOf);
      if (!match || LEGAL.test(`${groupName(group, radiosOf(group))} ${nameOf(match)}`)) return false;
      if (!isOn(match)) match.click();
      return isOn(match);
    };
    // A pressable-button group's title: the nearest label/legend/title/heading above it (not inside it), a few levels up.
    const titleAbove = group => {
      for (let up = group.parentElement, i = 0; up && i < 5; up = up.parentElement, i++) {
        const found = Array.from(up.querySelectorAll('label, legend, [class*=title], [class*=heading]')).find(el => !group.contains(el) && clean(el.textContent));
        if (found) return found;
      }
      return null;
    };
    const groupName = (group, radios) => String(nameOf(group) || '') && group.getAttribute('role') === 'radiogroup' ? nameOf(group)
      : String(titleAbove(group)?.textContent || nameOf(group) || questionOf(radios[0]) || '');
    // Parents of two or more pressable buttons that are a question: not a toolbar, a few named options.
    const pressableGroups = () => {
      const parents = new Map();
      for (const button of document.querySelectorAll('button[aria-pressed]')) {
        if (button.getAttribute('role') === 'radio' || !button.parentElement || button.closest('[role=radiogroup], [role=toolbar]')) continue;
        parents.set(button.parentElement, [...(parents.get(button.parentElement) || []), button]);
      }
      return [...parents].filter(([, buttons]) => buttons.length >= 2 && buttons.length <= 8 && buttons.every(visible) && buttons.every(button => clean(nameOf(button)))).map(([group]) => group);
    };
    // Every visible ARIA radio group, and pressable-button group, as a field (a group gets a key it keeps for the fill that follows).
    const ariaFields = () => [...document.querySelectorAll('[role=radiogroup]'), ...pressableGroups()].flatMap(group => {
      const radios = radiosOf(group).filter(visible);
      if (radios.length < 2) return [];
      const raw = groupName(group, radios);
      if (!clean(raw)) return [];
      if (!group.id && !group.dataset.jobpilottoGroup) group.dataset.jobpilottoGroup = `g${document.querySelectorAll('[data-jobpilotto-group]').length + 1}`;
      const question = clean(window.__jobPilottoRequired.clean(raw));
      const title = group.getAttribute('role') === 'radiogroup' ? null : titleAbove(group);
      return [{field: `aria:${group.id || group.dataset.jobpilottoGroup}`, label: question, type: 'radio',
        required: window.__jobPilottoRequired.has(raw) || /required/i.test(title?.className || '') || group.getAttribute('aria-required') === 'true' || radios.some(radio => radio.getAttribute('aria-required') === 'true'),
        options: radios.map(nameOf).filter(Boolean), filled: checked(radios), legal: LEGAL.test(question)}];
    });
    // The described ARIA fields as audit rows (the audit reads inputs only), with their state now.
    const ariaRows = form => form.filter(row => String(row.field).startsWith('aria:'))
      .map(row => ({...row, filled: checked(radiosOf(groupOf(row.field.slice(5))))}));
    return {nameOf, pickRadio, pickAriaRadio, ariaFields, ariaRows};
  };
})();

// Draws the typed control of each Your details contact field from renderer/contact-kinds.js: the existing input stays the one value everything reads and writes
// (the save, the proposals from the CV, the links tiles), hidden, and its `value` also redraws the control, so nothing else in the page changes. A control change
// sets the input and fires its "input" event, which marks the details as unsaved. Guarded by test/contact-kinds.test.js.
import {answerControl} from './question-control.js';
import {formatFor} from './question-kind.js';
import {CONTACT_KINDS} from './contact-kinds.js';

export function mountContactControls(root = document) {
  for (const input of root.querySelectorAll('[data-contact]')) {
    const spec = CONTACT_KINDS[input.dataset.contact];
    if (!spec || spec.kind === 'text' || input.dataset.mounted) continue;
    input.dataset.mounted = '1';
    const format = formatFor({marked: {kind: spec.kind, options: spec.options || []}});
    const label = input.closest('label')?.firstChild?.textContent?.trim() || input.dataset.contact;
    let value = String(input.value ?? ''), control = null;
    const draw = () => {
      const next = answerControl(format, value, answer => {
        value = answer;
        if (input.dispatchEvent) input.dispatchEvent(new Event('input', {bubbles: true})); else input.dispatch?.('input');
      }, {ariaLabel: label});
      next.dataset.contactControl = '1';
      if (control) control.replaceWith ? control.replaceWith(next) : input.parentNode.children.splice(input.parentNode.children.indexOf(control), 1, next);
      else if (input.after) input.after(next); else input.parentNode.append(next);
      control = next;
    };
    Object.defineProperty(input, 'value', {configurable: true, get: () => value, set: next => { value = String(next ?? ''); draw(); }});
    input.hidden = true;
    draw();
  }
}

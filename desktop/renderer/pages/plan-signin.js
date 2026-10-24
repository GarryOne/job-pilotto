// "I have Pro" on the Plan card (private spec jobadabra-lab:docs/specs/2026-10-16-pro-plan.md PR 5): e-mail address → a 6-digit code mailed by the site → this computer joins the Pro account
// (3 computers at most; a 4th picks the one to remove). Pro moves, data never does (Settings → Your data exports and imports). Guard: test/plan-signin.test.js.
import {el} from '../components.js';
import {message} from './core.js';
import {signinWords} from '../plan-view.js';

// Builds the "I have Pro" button and its steps; onDone: what shows the plan again once this computer is Pro.
export function signinPart(onDone) {
  const box = el('div', 'plan-signin', ''), open = el('button', 'secondary', 'I have Pro'), steps = el('div', 'inline', '');
  open.id = 'plan-have-pro';
  steps.hidden = true;
  const email = el('input', '', ''), code = el('input', '', ''), send = el('button', 'secondary', 'Send code'), check = el('button', 'primary', 'Add this computer'), devices = el('div', '', '');
  Object.assign(email, {type: 'email', placeholder: 'The e-mail you bought Pro with', autocomplete: 'email'});
  Object.assign(code, {type: 'text', placeholder: '6-digit code', maxLength: 7, autocomplete: 'one-time-code', inputMode: 'numeric'});
  code.hidden = check.hidden = true;
  const verify = async remove => {
    const answer = await window.pilot.planSignin('verify', {email: email.value, code: code.value, remove});
    if (answer.ok) { message('plan-message', 'This computer now has Pro.', 'ok'); onDone(); return; }
    if (answer.error === 'devices') { chooseDevice(answer.devices || []); return; }
    message('plan-message', signinWords(answer), 'error');
  };
  const chooseDevice = list => {
    devices.replaceChildren(el('p', 'muted small', 'Pro is on 3 computers. Remove one to add this one:'));
    list.forEach((device, index) => {
      const button = el('button', 'secondary', `Computer ${index + 1}, last used ${String(device.lastSeen || device.added || '').slice(0, 10) || 'unknown'}`);
      button.addEventListener('click', () => verify(device.id));
      devices.append(button);
    });
  };
  send.addEventListener('click', async () => {
    message('plan-message', 'Sending the code…');
    const answer = await window.pilot.planSignin('start', {email: email.value});
    message('plan-message', answer.ok ? `If that address has Pro, a code is on its way (valid ${answer.minutes || 10} minutes).` : signinWords(answer), answer.ok ? 'ok' : 'error');
    if (answer.ok) code.hidden = check.hidden = false;
  });
  check.addEventListener('click', () => verify());
  open.addEventListener('click', () => { steps.hidden = !steps.hidden; if (!steps.hidden) email.focus(); });
  steps.append(email, send, code, check);
  box.append(open, steps, devices);
  return box;
}

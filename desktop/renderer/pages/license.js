// Settings → License: the free allowance ("12 of 30 free applications · 41 days left"), pasting a key (checked on this
// Mac, lib/license.js), and the friendly dialog when the allowance ends (main asks for it, 'allowance' event).
import {$, message} from './core.js';
import {openSetting} from './settings.js';

const KIND = {founder: 'Founder', friend: 'Friend', pass: 'Pass'};

export function showLicense(state) {
  const {licensed, ended} = state;
  $('license-pill').textContent = licensed ? `${KIND[state.license.kind]} key` : ended ? 'Free period over' : 'Free';
  $('license-pill').className = `ui-pill tone-${licensed ? 'good' : ended ? 'warn' : 'info'}`;
  $('license-used').textContent = licensed ? `${state.used} · no limit` : `${state.used} of ${state.limit}`;
  $('license-days-label').textContent = licensed ? 'Licensed to' : 'Days left';
  $('license-days').textContent = licensed ? state.license.name : `${state.daysLeft} of 60`;
  $('license-bar').hidden = licensed;
  $('license-bar').firstElementChild.style.width = `${Math.max(2, Math.min(100, state.used / state.limit * 100))}%`;
  $('license-note').textContent = licensed ? (state.license.until ? `Valid until ${state.license.until}.` : 'No end date.')
    : ended ? 'New applications, kits and searches are paused. Tracking, Notion, export and your data keep working.'
      : 'Free until you reach 30 applications and 60 days have passed, whichever comes later.';
  $('license-paste').hidden = licensed;
  $('license-held').hidden = !licensed;
  $('license-holder').textContent = licensed ? `${state.license.name} · ${KIND[state.license.kind]} key${state.license.until ? ` · until ${state.license.until}` : ''}` : '';
  $('license-key-title').textContent = licensed ? 'License key' : 'Have a key?';
  if (state.keyProblem) message('license-message', `Saved key: ${state.keyProblem}`, 'error');
}

async function unlock(input, messageId) {
  const result = await window.pilot.licenseSet(input.value);
  if (!result.ok) return message(messageId, result.error, 'error');
  input.value = '';
  message(messageId, `Unlocked ✓ Welcome, ${result.state.license.name}.`, 'ok');
  showLicense(result.state);
  $('allowance-dialog').open && setTimeout(() => $('allowance-dialog').close(), 900);
}

export async function init() {
  const refresh = async () => showLicense(await window.pilot.license());
  await refresh();
  document.querySelector('[data-settings-go="license"]').addEventListener('click', refresh);
  $('license-save').addEventListener('click', () => unlock($('license-input'), 'license-message'));
  $('license-input').addEventListener('keydown', event => { if (event.key === 'Enter') unlock($('license-input'), 'license-message'); });
  $('license-remove').addEventListener('click', async () => { message('license-message', ''); showLicense(await window.pilot.licenseRemove()); });
  // The allowance ended and something new was started: say so once, kindly, and offer the key.
  window.pilot.onAllowance(state => {
    showLicense(state);
    message('allowance-message', '');
    if (!$('allowance-dialog').open) $('allowance-dialog').showModal();
  });
  $('allowance-unlock').addEventListener('click', () => unlock($('allowance-input'), 'allowance-message'));
  $('allowance-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); unlock($('allowance-input'), 'allowance-message'); } });
  $('allowance-settings').addEventListener('click', () => { $('allowance-dialog').close(); openSetting('license'); });
}

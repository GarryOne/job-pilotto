// Settings → License: the free allowance ("12 of 40 free applications · 41 days left"), also as a small counter in the sidebar, pasting a key (checked on this
// Mac, lib/license.js), and the friendly dialog when the allowance ends (main asks for it, 'allowance' event).
import {$, message} from './core.js';
import {openSetting} from './settings.js';
import {chip} from '../license-chip.js';

const KIND = {founder: 'Founder', friend: 'Friend', pass: 'Pass'};

// The sidebar counter: "28 free applications left" with a thin bar; a click opens Settings → License. Hidden for a licensed install.
function showChip(state) {
  const shown = chip(state);
  const button = $('allowance-chip');
  button.hidden = !shown;
  if (!shown) return;
  $('allowance-chip-plan').textContent = shown.plan;
  $('allowance-chip-text').textContent = shown.text;
  button.title = shown.title;
  button.dataset.tone = shown.tone;
  $('allowance-chip-fill').style.width = `${shown.percent}%`;
}

export function showLicense(state) {
  showChip(state);
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
      : `Free until you reach ${state.limit} applications and 60 days have passed, whichever comes later.`;
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
  $('allowance-chip').addEventListener('click', () => openSetting('license'));
  // The count moves as applications are sent: look again now and then, and when the window comes back to the front.
  setInterval(() => refresh().catch(() => {}), 10 * 60 * 1000);
  window.addEventListener('focus', () => refresh().catch(() => {}));
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

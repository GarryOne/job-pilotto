// Hosted Always on in the window (spec docs/superpowers/specs/2026-10-16-hosted-always-on.md §4b, §4d): the wizard's step 4 "New matching jobs every morning, even when your Mac is off"
// (switch ON, e-mail, a pre-checked product-news box, Skip / Turn on) and the Settings card that turns it off and deletes, or downloads, what we hold. Built here, not in index.html.
// Words: never "GitHub", "container" or dollars. The data call is lib/hosted-search.js. Guard: test/hosted-view.test.js.
import {el, pill, tile} from '../components.js';
import {$, message, show} from './core.js';
import {goStep} from './wizard.js';
import {shared} from './shared.js';

export const HEADLINE = 'New matching jobs every morning, even when your Mac is off';
export const STORED = 'Your profile is stored encrypted on our servers. Turn it off anytime = deleted.';
export const NEWS = 'Also send me product news and the Pro launch offer (unsubscribe in one click)';

function switchRow(id, label, checked, hint = '') {
  const input = Object.assign(document.createElement('input'), {type: 'checkbox', id, checked});
  input.setAttribute('aria-label', label);
  const row = el('div', 'switch-row');
  row.append(el('span', 'switch', input), el('span', '', Object.assign(el('span'), {textContent: label})));
  row.lastChild.append(...(hint ? [el('span', 'muted small', hint)] : []));
  row.querySelector('.switch').append(document.createElement('span'));
  return row;
}
const emailField = id => {
  const input = Object.assign(document.createElement('input'), {type: 'email', id, placeholder: 'you@example.com', autocomplete: 'email', size: 36});
  const label = el('label', 'inline-field', 'Where should we send them?');
  label.append(input);
  return label;
};

// Wizard step 4. Skip only leaves hosted off; the rest of the app works as before.
export function mountStep() {
  if ($('hosted-step-root')) return;
  const step = el('div', 'step');
  step.id = 'hosted-step-root'; step.dataset.step = 'hosted'; step.hidden = true;
  const head = el('header', 'view-head step-head');
  const text = el('div');
  text.append(el('span', 'eyebrow', 'Step 4 of 5'), el('h1', '', HEADLINE), el('p', 'muted subtitle', 'A short list of what is new, by e-mail, and in the app when you open it.'));
  head.append(text);
  const body = el('div', 'panel');
  const actions = el('div', 'actions');
  const skip = el('button', 'ghost', 'Skip'); skip.id = 'hosted-skip';
  const go = el('button', 'primary', 'Turn on Always on'); go.id = 'hosted-go';
  actions.append(skip, go);
  const note = el('p', 'message'); note.id = 'hosted-message';
  body.append(switchRow('hosted-daily', 'Search for me every day', true), emailField('hosted-email'), switchRow('hosted-news', NEWS, true), el('p', 'muted small', STORED), note);
  step.append(head, body, actions);
  document.querySelector('.step[data-step="extras"]').before(step);
  const item = el('li', '', 'Daily searches'); item.dataset.step = 'hosted';
  document.querySelector('#step-list li[data-step="extras"]').before(item);
  skip.addEventListener('click', async () => { await window.pilot.hostedOff(); goStep('extras'); });
  go.addEventListener('click', async () => {
    if (!$('hosted-daily').checked) { await window.pilot.hostedOff(); goStep('extras'); return; }   // the switch turned off here is the same as Skip
    go.disabled = true; message('hosted-message', 'Turning on…');
    const done = await window.pilot.hostedOn({email: $('hosted-email').value, marketing: $('hosted-news').checked});
    go.disabled = false;
    if (!done.ok) { message('hosted-message', done.error || 'Could not turn it on just now.', 'bad'); return; }
    goStep('extras');
  });
}

// Settings → Always on: "Search for me every day" with its state, Turn off (and delete), Download my data.
export function mountCard() {
  if ($('setting-hosted')) return;
  const card = el('div', 'setting panel'); card.id = 'setting-hosted';
  const head = el('div', 'summary-head'); head.append(el('h3', '', 'Daily searches while your Mac is off'));
  const row = el('div', 'aon-row');
  const info = el('div', 'aon-text'), title = el('div', 'aon-title'), status = el('p', 'muted small'); status.id = 'hosted-status';
  const pillHost = el('span'); pillHost.id = 'hosted-pill';
  title.append(el('b', '', 'On our servers'), pillHost); info.append(title, status);
  const buttons = el('div', 'aon-actions');
  const mk = (id, label, cls) => { const button = el('button', cls, label); button.id = id; return button; };
  const on = mk('hosted-turn-on', 'Turn on daily searches', 'secondary'), off = mk('hosted-turn-off', 'Turn off and delete my data', 'ghost'), save = mk('hosted-download', 'Download my hosted data', 'ghost');
  buttons.append(on, off, save);
  const email = emailField('hosted-set-email'), msg = el('p', 'message'); msg.id = 'hosted-set-message';
  row.append(tile('cloud'), info, buttons);
  card.append(head, el('p', 'muted panel-lead', STORED), row, email, msg);
  $('setting-cloud').after(card);
  on.addEventListener('click', async () => {
    const done = await window.pilot.hostedOn({email: $('hosted-set-email').value, marketing: false});
    message('hosted-set-message', done.ok ? 'On ✓' : done.error || 'Could not turn it on just now.', done.ok ? 'ok' : 'bad');
    refresh();
  });
  off.addEventListener('click', async () => { const done = await window.pilot.hostedOff(); message('hosted-set-message', done.ok ? 'Off. Everything we held is deleted.' : done.error || 'Could not turn it off just now.', done.ok ? 'ok' : 'bad'); refresh(); });
  save.addEventListener('click', async () => { const done = await window.pilot.hostedExport(); if (!done.cancelled) message('hosted-set-message', done.ok ? 'Saved ✓' : done.error || 'Could not save it just now.', done.ok ? 'ok' : 'bad'); });
  window.pilot.onHostedArrived(refresh);
  refresh();
}

export async function refresh() {
  const now = await window.pilot.hostedState();
  shared.hosted = now;
  if (!$('hosted-status')) return;
  $('hosted-pill').replaceChildren(pill(now.on ? 'On' : 'Off', now.on ? 'good' : 'neutral', {dot: true}));
  $('hosted-status').textContent = now.on ? `Searches every day and e-mails ${now.email}. New matches also appear here when you open the app.` : 'Off. Turn it on to get new matches every morning, even when your Mac is off.';
  show($('hosted-turn-on'), !now.on); show($('hosted-turn-off'), !!now.on); show($('hosted-download'), !!now.on);
  if (now.email && !$('hosted-set-email').value) $('hosted-set-email').value = now.email;
}

export function init() { mountStep(); mountCard(); }

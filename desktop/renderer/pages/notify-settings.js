// Settings → Automation → Notifications ("Tell me by"): e-mail, app notifications, Telegram, any mix, plus the address, how often the digest comes and the product-news tick (pre-checked, unsubscribe in one click).
// Saves at once like the rest of Automation. The choice and the address live in lib/notify-channel.js; the engine and the Always on repo follow it.
import {$} from './core.js';

const BOXES = {email: 'notify-email', app: 'notify-app', telegram: 'notify-telegram'};
let busy = false;

export async function showNotify() {
  const state = await window.pilot.notifyState().catch(() => null);
  if (!state) return;
  for (const [name, id] of Object.entries(BOXES)) $(id).checked = state.by.includes(name);
  $('notify-address').value = state.email || '';
  $('notify-marketing').checked = state.marketing;
  $('notify-cadence').value = state.cadence || 'daily';
  $('notify-telegram').disabled = !state.telegram;
  $('notify-telegram-note').textContent = state.telegram ? 'Your own bot: digests and reminders as before.' : 'Your own bot. Connect it in Settings → Connections first.';
  $('notify-email-note').textContent = !state.email ? 'The same cards as Telegram, in your inbox. Add your address below.'
    : state.confirmed ? `To ${state.email} (confirmed).` : `To ${state.email}. Confirm it with the link in your first email.`;
  $('notify-message').textContent = state.reached ? '' : 'Offline: your address is saved when the website is reachable.';
}

export function bindNotify({savedToast, updateRepo}) {
  const save = async () => {
    if (busy) return;
    busy = true;
    try {
      const by = Object.entries(BOXES).filter(([, id]) => $(id).checked).map(([name]) => name);
      const result = await window.pilot.notifySave({by, email: $('notify-address').value, marketing: $('notify-marketing').checked, cadence: $('notify-cadence').value});
      $('notify-message').textContent = result.ok ? '' : result.error;
      if (result.ok) { savedToast('Saved ✓', `Tell me by: ${by.join(', ') || 'nothing'}`); updateRepo(); }
    } finally { busy = false; }
    await showNotify();
  };
  for (const id of [...Object.values(BOXES), 'notify-address', 'notify-marketing', 'notify-cadence']) $(id).addEventListener('change', save);
}

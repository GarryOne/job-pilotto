// Settings → Help the pool grow (opt-in; lib/pool-share.js): the switch and, on request, exactly what would be sent.
import {$} from './core.js';

async function show() {
  const {text} = await window.pilot.poolShareShown().catch(() => ({text: 'Could not work out what would be sent right now.'}));
  $('pool-share-text').textContent = text;
}

export async function init() {
  const {on} = await window.pilot.poolShareGet().catch(() => ({on: true}));
  $('pool-share-on').checked = on;
  $('pool-share-on').addEventListener('change', async event => { await window.pilot.poolShareSet(event.target.checked); });
  document.querySelector('.pool-share-shown').addEventListener('toggle', event => { if (event.target.open) show(); });
}

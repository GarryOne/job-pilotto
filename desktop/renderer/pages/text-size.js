// Text size (Settings → Appearance): Small / Default / Large, the same setting ⌘+ ⌘- ⌘0 change (lib/zoom-handlers.js keeps it). Also keeps the small fonts readable at a zoomed-out size (renderer/zoom-view.js).
import {$} from './core.js';
import {SIZE_TEXT, floorTokens} from '../zoom-view.js';

const known = new Set();   // the token overrides set now
function paint(state) {
  if (!state) return;
  const floors = floorTokens(state.factor);
  for (const name of known) if (!(name in floors)) { document.documentElement.style.removeProperty(name); known.delete(name); }
  for (const [name, value] of Object.entries(floors)) { document.documentElement.style.setProperty(name, value); known.add(name); }
  document.querySelectorAll('[data-size-choice]').forEach(button => button.classList.toggle('is-active', button.dataset.sizeChoice === state.choice));
  const text = $('text-size-text');
  if (text) text.textContent = `${Math.round(state.factor * 100)}%. ${SIZE_TEXT[state.choice || 'other']}`;
}

export async function init() {
  document.querySelectorAll('[data-size-choice]').forEach(button => button.addEventListener('click', async () => paint(await window.pilot.setTextSize(button.dataset.sizeChoice))));
  window.pilot.onZoomChanged?.(paint);   // ⌘+ ⌘- ⌘0 from the View menu
  paint(await window.pilot.textSize?.().catch(() => null));
}

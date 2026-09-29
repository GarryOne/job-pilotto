// Theme: System / Light / Dark (Settings → Appearance) and the sidebar's one-click switch.
// The app sets Electron's theme source (main.js setTheme), so prefers-color-scheme and tokens.css follow the choice.
// A display preference of this Mac: kept in the app's settings, not in Notion.
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$} from './core.js';

const dark = matchMedia('(prefers-color-scheme: dark)');
const TEXT = {system: 'Follows your Mac: light by day, dark at night if macOS switches.', light: 'Always light.', dark: 'Always dark, like the departures hall.'};
let choice = 'system';

function paint() {
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.classList.toggle('is-active', button.dataset.themeChoice === choice));
  const text = $('theme-text');
  if (text) text.textContent = TEXT[choice];
  const toggle = $('theme-toggle');
  if (!toggle) return;
  const next = dark.matches ? 'light' : 'dark';
  toggle.querySelector('svg')?.replaceWith(icon(next === 'dark' ? 'moon' : 'sun'));
  $('theme-toggle-label').textContent = next === 'dark' ? 'Dark theme' : 'Light theme';
  toggle.title = `Switch to the ${next} theme`;
}

async function pick(value) {
  choice = await window.pilot.setTheme(value);
  if (shared.state?.settings) shared.state.settings.theme = choice;
  paint();
}

export async function init() {
  choice = shared.state?.settings?.theme || 'system';
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => pick(button.dataset.themeChoice)));
  $('theme-toggle')?.addEventListener('click', () => pick(dark.matches ? 'light' : 'dark'));
  dark.addEventListener('change', paint);
  paint();
}

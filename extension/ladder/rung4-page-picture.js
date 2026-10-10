// What the closer look takes of a page (spec: docs/superpowers/specs/2026-10-08-ai-escalation.md): the typed values are hidden BEFORE the screenshot and shown again right after, so labels and
// layout reach the model and the person's name, email and answers do not. Injected into the page (each export stands alone). Guard: worker/test/page-picture.test.js.
const STYLE_ID = 'jobpilotto-hide-values';

// Every input's, textarea's and select's text becomes transparent (and a password's dots), selected options too; nothing is changed, nothing is stored.
export function hideValues() {
  if (document.getElementById(STYLE_ID)) return true;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = 'input, textarea, select, option { color: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; } input::placeholder, textarea::placeholder { color: transparent !important; }';
  (document.head || document.documentElement).append(style);
  return true;
}
export function showValues() {
  document.getElementById(STYLE_ID)?.remove();
  return true;
}

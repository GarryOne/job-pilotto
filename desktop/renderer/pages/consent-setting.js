// Settings → "Consent boxes": whether a fill ticks consent and data-notice boxes for the person (owner, 17 Oct 2026: on by default, a formality; the AI reads which
// box is one, extension/page/fill-checks.js). The app is the source: the extension asks it on every fill (/extension/me). Guarded by test/consent-setting.test.js.

export const consentOn = settings => settings?.acceptConsents !== false;
export async function init() {
  const box = document.getElementById('consent-tick');
  if (!box) return;
  box.checked = consentOn((await window.pilot.state().catch(() => null))?.settings);
  box.addEventListener('change', () => window.pilot.saveSettings({acceptConsents: box.checked}));
}

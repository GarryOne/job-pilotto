// Settings → Advanced → "Read refused sites in my browser" (owner, 19 Oct 2026): ON by default (owner, 20 Oct 2026: "opt-out"), the person can turn it off; the app is the source (lib/refused-reads.js asks it on every extension call).
// When on and the extension lacks the all-sites permission, the app has set refusedNeedsAllow and the card says what to press. Guarded by test/refused-reads.test.js.

export const readRefusedOn = settings => settings?.readRefusedSites !== false;
export async function init() {
  const box = document.getElementById('refused-read-tick');
  if (!box) return;
  const paint = settings => {
    box.checked = readRefusedOn(settings);
    document.getElementById('refused-read-allow').hidden = !(box.checked && settings?.refusedNeedsAllow === true);
  };
  paint((await window.pilot.state().catch(() => null))?.settings);
  box.addEventListener('change', async () => {
    await window.pilot.saveSettings({readRefusedSites: box.checked});
    paint((await window.pilot.state().catch(() => null))?.settings);
  });
}

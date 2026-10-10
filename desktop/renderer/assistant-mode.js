// How much Job Pilotto does on an application (owner, 10 Oct 2026: "at most 2 modes", automatic by default): settings.accountAutomation 'full' = "Do it for me"
// (the default: accounts made and signed in to, their terms accepted, the confirmation link opened when Gmail is connected, a closer look at an unclear account
// page), 'assist' = "Let me check each step". Never in either: an application's Submit, a captcha or bot check, an SMS code. Shown on Settings → Profile and
// in the setup (pages/settings.js, pages/profile.js, pages/startup.js); desktop/lib/site-accounts.js automationOf reads it. Guard: test/assistant-mode.test.js.
export const MODE_TEXT = {
  full: 'Fills every form, creates and signs in to employer accounts (accepting the account\'s terms), opens the confirmation link or types the code from your email when Gmail is connected, and takes a closer look at an unclear account page (a screenshot to the AI, what you typed hidden, at most 10 a day). Never: an application\'s Submit, a captcha or bot check, an SMS code.',
  assist: 'Fills every form. You accept an account\'s terms, press its buttons and type its codes. Never: an application\'s Submit, a captcha or bot check.',
};
export const modeOfSettings = settings => (settings?.accountAutomation === 'assist' ? 'assist' : 'full');

export function showMode(settings, doc = document) {
  const mode = modeOfSettings(settings);
  doc.querySelectorAll('[data-assistant-mode]').forEach(button => button.classList.toggle('is-active', button.dataset.assistantMode === mode));
  const text = doc.getElementById('assistant-mode-text');
  if (text) text.textContent = MODE_TEXT[mode];
  return mode;
}

// save(patch) -> the saved settings. Each button saves its mode and redraws.
export function wireMode(save, doc = document) {
  doc.querySelectorAll('[data-assistant-mode]').forEach(button => button.addEventListener('click', async () => {
    showMode(await save({accountAutomation: button.dataset.assistantMode === 'assist' ? 'assist' : 'full'}), doc);
  }));
}

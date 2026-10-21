/* global document */
// Open a page the way a person does: press its menu button; a page the menu shows only once it has content (Interviews, Calendar, Reports) is opened as ⌘K does.
// Profile is a menu button of the settings view too (data-view="settings" data-settings="profile"): "settings" means the menu's Settings button, never Profile (#1690).
export const navSelector = view => `.nav[data-view="${view}"]${view === 'settings' ? ':not([data-settings="profile"])' : ''}`;

export async function goView(page, view, options = {}) {
  const selector = navSelector(view);
  if (await page.locator(selector).first().isVisible().catch(() => false)) return page.click(selector, options);
  await page.evaluate(sel => document.querySelector(sel).click(), selector);
}

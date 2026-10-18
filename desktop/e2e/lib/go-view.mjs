/* global document */
// Open a page the way a person does: press its menu button; a page the menu shows only once it has content (Interviews, Calendar, Reports) is opened as ⌘K does.
export async function goView(page, view, options = {}) {
  const selector = `.nav[data-view="${view}"]`;
  if (await page.locator(selector).first().isVisible().catch(() => false)) return page.click(selector, options);
  await page.evaluate(sel => document.querySelector(sel).click(), selector);
}

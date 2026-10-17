/* global document */
// Open a page the way a person does: press its menu button; a page the menu shows only once it has content (Interviews, Reports) is opened as ⌘K does, and Calendar is the tab inside Interviews.
export async function goView(page, view, options = {}) {
  if (view === 'calendar') {
    await goView(page, 'interviews', options);
    await page.click('.view[data-view="interviews"] [data-iv-tab="calendar"]', options);
    return;
  }
  const selector = `.nav[data-view="${view}"]`;
  if (await page.locator(selector).first().isVisible().catch(() => false)) return page.click(selector, options);
  await page.evaluate(sel => document.querySelector(sel).click(), selector);
}

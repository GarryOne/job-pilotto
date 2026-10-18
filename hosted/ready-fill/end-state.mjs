// A held tab shows only the form's end state: every box the extension draws on the page (its panel, progress, notes, all with an id starting
// "jobpilotto-") is hidden, on this page and on every page the tab loads later (a next step of the form). Owner, 18 Oct 2026: "see the end result
// instant. All the fields filled already. The extension should do nothing. It should show the end state." Guard: desktop/test/ready-fill.test.js.
export const HIDE_CSS = '[id^="jobpilotto-"]:not(style) { display: none !important; }';

// page: a Playwright page. Never throws: a page that is gone keeps nothing to hide.
export async function showEndState(page) {
  await page.addInitScript(css => {
    const add = () => document.head?.append(Object.assign(document.createElement('style'), {textContent: css}));
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add, {once: true});
  }, HIDE_CSS).catch(() => {});
  await page.addStyleTag({content: HIDE_CSS}).catch(() => {});
}

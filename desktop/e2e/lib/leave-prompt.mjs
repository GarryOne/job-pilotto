// Going to a page when the one being left may ask first: Strategy with unsaved edits opens #strategy-leave-dialog (Save / Discard / Keep editing,
// renderer/pages/strategy.js leaveStrategy), a modal that covers every later click (CI run 241, 9 Oct 2026: six interactions steps timed out behind it).
// A suite's own edits are nobody's: discard them and say so. Used by suites/interactions.mjs; guarded by test/leave-prompt.test.mjs.
export async function goTo(page, view, say = console.log) {
  await page.click(`.nav[data-view="${view}"]`);
  const leave = page.locator('#strategy-leave-dialog[open]');
  if (!await leave.count()) return false;
  await leave.locator('button[value="discard"]').click();
  await page.locator(`.view[data-view="${view}"]:not([hidden])`).waitFor({timeout: 15000});
  say(`  leaving Strategy asked about unsaved edits the suite made: discarded, on to ${view}`);
  return true;
}

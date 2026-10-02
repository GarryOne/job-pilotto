// Chooses a job in a searchable picker the way a person does (desktop/renderer/search-select.js): the native <select> is hidden and stays the source of truth,
// a search box with a list of matches sits in front of it. Typing the option's text and clicking the match fires the select's change event. 2 Oct 2026: when the job
// selects of the dialogs became pickers, page.selectOption on them timed out (the select is no longer visible) and the interviews suite broke.
export async function pickJob(select, value) {
  const text = (await select.locator(`option[value="${value}"]`).first().textContent()).trim();
  const wrap = select.locator('xpath=..');
  const box = wrap.locator('.select-search input');
  await box.click();
  await box.fill(text);
  await wrap.locator('.lead-job-options').getByRole('option', {name: text, exact: true}).click();
}

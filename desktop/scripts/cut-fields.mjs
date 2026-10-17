// The cut-value check npm run shot prints after every picture (design system, owner 17 Oct 2026: saved answers cut mid-sentence in one-line boxes):
// a visible text box whose saved value is wider than the box. Evaluated in the window; scoped to --select when given. Guarded by test/shot-cut-fields.test.js.
export const cutFields = (scope = '') => `[...(document.querySelector(${JSON.stringify(scope || 'body')}) || document.body)
  .querySelectorAll('input:not([type]), input[type=text], input[type=email], input[type=url], input[type=search]')]
  .filter(field => field.offsetParent && field.value && field.scrollWidth > field.clientWidth + 1)
  .map(field => ({field: field.getAttribute('aria-label') || field.closest('label')?.textContent.trim().slice(0, 40) || field.id || field.name || '?', value: field.value.slice(0, 60)}))`;

// -> the lines to print (none when nothing is cut).
export function cutReport(found) {
  if (!Array.isArray(found) || !found.length) return [];
  return [`✂ ${found.length} saved value${found.length > 1 ? 's' : ''} cut by ${found.length > 1 ? 'their boxes' : 'its box'} (docs/rules/desktop-ui.md "Value → control": a long value is long text or a note, a typed one its control):`,
    ...found.map(({field, value}) => `  ${field}: "${value}…"`)];
}

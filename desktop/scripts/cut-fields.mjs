// The cut-value check npm run shot prints after every picture (design system, owner 17 Oct 2026: saved answers cut mid-sentence in one-line boxes):
// a visible text box whose saved value is wider than the box. Evaluated in the window; scoped to --select when given. Guarded by test/shot-cut-fields.test.js.
// Also two choice checks (owner, 18 Oct 2026: a Target level showed its options as one borderless column, none picked): a choice row (.segmented) of 3+ options
// drawn as one column, and a choice holding a saved value (data-saved-value, renderer/question-control.js) with nothing picked and no "Saved as: …".
export const cutFields = (scope = '') => `(() => {
  const root = document.querySelector(${JSON.stringify(scope || 'body')}) || document.body;
  const name = node => node.getAttribute('aria-label') || node.closest('label')?.textContent.trim().slice(0, 40) || node.id || node.name || '?';
  const cut = [...root.querySelectorAll('input:not([type]), input[type=text], input[type=email], input[type=url], input[type=search]')]
    .filter(field => field.offsetParent && field.value && field.scrollWidth > field.clientWidth + 1)
    .map(field => ({field: name(field), value: field.value.slice(0, 60)}));
  const column = [...root.querySelectorAll('.segmented')]
    .filter(group => group.offsetParent && group.children.length >= 3 && new Set([...group.children].map(button => button.offsetLeft)).size === 1)
    .map(group => ({kind: 'column', field: name(group), value: [...group.children].map(button => button.textContent).join(' / ').slice(0, 60)}));
  const unseen = [...root.querySelectorAll('[data-saved-value]')]
    .filter(group => group.offsetParent && group.dataset.savedValue && !group.querySelector('.is-active') && !group.parentElement?.querySelector('.qa-saved-as'))
    .map(group => ({kind: 'unseen', field: name(group), value: group.dataset.savedValue.slice(0, 60)}));
  return [...cut, ...column, ...unseen];
})()`;

// -> the lines to print (none when nothing is cut).
export function cutReport(found) {
  if (!Array.isArray(found) || !found.length) return [];
  const of = kind => found.filter(each => (each.kind || 'cut') === kind), cut = of('cut'), column = of('column'), unseen = of('unseen'), out = [];
  if (cut.length) out.push(`✂ ${cut.length} saved value${cut.length > 1 ? 's' : ''} cut by ${cut.length > 1 ? 'their boxes' : 'its box'} (docs/rules/desktop-ui.md "Value → control": a long value is long text or a note, a typed one its control):`,
    ...cut.map(({field, value}) => `  ${field}: "${value}…"`));
  if (column.length) out.push(`▤ ${column.length} choice row${column.length > 1 ? 's' : ''} drawn as one column (a .segmented.is-fill wraps into framed rows; check the container's width):`,
    ...column.map(({field, value}) => `  ${field}: ${value}`));
  if (unseen.length) out.push(`◌ ${unseen.length} saved value${unseen.length > 1 ? 's' : ''} its choice does not show (nothing picked, no "Saved as: …"):`,
    ...unseen.map(({field, value}) => `  ${field}: "${value}"`));
  return out;
}

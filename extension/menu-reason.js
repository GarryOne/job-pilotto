// Why a drop-down menu was left empty, as OBSERVED by the pick (flow.js clickCombos: opened, found, selectedAfter, trusted), never assumed.
// Until 9 Oct 2026 every armed menu left empty was "dropdown that opens only on a real click" (cause real_click): a label, not a measurement,
// so the learning digest ranked the wrong cause (Migros: the menu opened and the option was found, but a scripted click did not select it).
// One row per observation: the reason text the fill row carries, the fixed cause word the fill card and the site count (fill-card.js CAUSES,
// desktop/lib/question-labels.js LEFT_REASONS, site/src/knowledge.js). Guarded by worker/test/menu-reason.test.js.
export const MENU_REASONS = [
  {text: 'dropdown not clicked', cause: 'menu_not_clicked'},                         // no trusted click: the setting is off, or the click failed
  {text: 'dropdown clicked, but its menu did not open', cause: 'menu_not_opened'},
  {text: 'dropdown clicked, but no option matched', cause: 'no_option'},             // open, and no option meant the answer
  {text: 'dropdown option clicked, but not selected', cause: 'menu_not_selected'},   // the field is still empty after the pick
  {text: 'dropdown selected, but the reader cannot see it', cause: 'menu_not_read'},  // the widget holds it; our reader does not see it
];
export const OLD_MENU_REASON = 'dropdown that opens only on a real click';   // a version before these observations: cause real_click

// combo: one result of clickCombos -> the reason text for a menu that was not picked. null fields mean "not observed".
export function menuReason(combo) {
  const words = cause => MENU_REASONS.find(item => item.cause === cause).text;
  if (combo.selectedAfter === true) return words('menu_not_read');
  if (combo.found === true) return words('menu_not_selected');
  if (combo.opened === false) return words('menu_not_opened');
  if (combo.opened === true) return words('no_option');
  return words('no_option');   // nothing observed (an older page script): as before
}
// A row's reason text (timing in parentheses ignored) -> its cause word, or '' when it is not a menu reason.
export function menuCause(reason) {
  const text = String(reason || '').replace(/\s*\([^)]*\)$/, '').replace(/:.*$/, '');
  if (text === OLD_MENU_REASON) return 'real_click';
  return MENU_REASONS.find(item => item.text === text)?.cause || '';
}

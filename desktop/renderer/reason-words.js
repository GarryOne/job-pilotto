// The person card's reason line for a control the fill left: one plain sentence per reason class (extension/ladder/control-ending.js REASONS; the test fails when one has no words here).
export const REASON_WORDS = {
  no_answer: 'We have no answer for this yet: give it once and it is remembered.',
  unread: 'This question on the page could not be read.',
  tries: 'The site did not keep the answer after 3 tries.',
  not_kept: 'The field did not take the answer.',
  unknown: 'Left empty, and the fill could not say why.',
};
// The reason for one left control of a form state (reviewStates), matched by the label the panel sent; '' when none.
export const reasonFor = (state, label, same) => REASON_WORDS[(state?.reasons || []).find(item => item.label === label || same?.(item.label, label))?.reason] || '';

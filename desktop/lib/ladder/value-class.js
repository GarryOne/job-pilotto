// The fill ladder's value classes (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 3): the fixed list of KINDS of value the fill gave a control, computed in the browser
// (extension/page/value-class.js, the same list: desktop/test/fill-repair.test.js fails when they differ) and kept on the desktop only when it is one of these.
export const VALUE_CLASSES = ['dial_code', 'country_name', 'email_shaped', 'phone', 'date', 'number', 'url', 'free_text', 'none'];

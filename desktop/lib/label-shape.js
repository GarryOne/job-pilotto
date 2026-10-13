// Whether a form label is a sentence asking something (ends in a question mark after four words or more, or runs past eight words) rather than a field's name: a question is
// for the AI, never read by a contact-detail word list (13 Oct 2026: "mobile" inside "Have you automated mobile builds?" put a phone number into it). By shape, no words.
// The same rule as the extension's page/fill-labels.js asksQuestion and form-ready.js (plain scripts; test/label-shape.test.js keeps the three equal).
export const asksQuestion = text => {
  const words = String(text || '').replace(/[\s*]+$/, '').split(/\s+/).filter(Boolean);
  return words.length >= 4 && /[?？]$/.test(words.at(-1)) || words.length > 8;
};

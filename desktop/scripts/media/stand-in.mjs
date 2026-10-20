// What the extension's stand-in app hands the fictional form in the product videos (desktop/scripts/media/record-extension.mjs): the page with the
// persona's job in it, and the persona's answers to the form's own questions, as Claude would give them. Pure. Guard: desktop/test/media-options.test.js.

// The form page with the persona's job in it. Pure.
export const formHtml = (template, job) => template.replace(/\{\{(company|title|place|city)\}\}/g, (_, key) => String(job[key] ?? ''));

// What the stand-in app answers for the form's open questions: the persona's answer per field the extension asks about. Pure.
export function answerReply(body, answers) {
  let asked = [];
  try { asked = JSON.parse(body || '{}').fields || []; } catch { /* not JSON: nothing asked */ }
  return {ok: true, eligible: true, answers: asked.filter(field => answers[field.field] != null).map(field => ({field: field.field, value: answers[field.field]}))};
}

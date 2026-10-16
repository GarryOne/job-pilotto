// Worked examples for the form-answer ask (worker/src/extension.js INSTRUCTIONS): the shapes a smaller model gets wrong, as answers, not rules. Fictional fields only; the form may be in any language.
// Added 16 Oct 2026 from the Free AI form set (tools/free-ai-form-asks.mjs): a voluntary question with a "decline" option came back empty. Guarded by worker/test/answer-examples.test.js.
export const ANSWER_EXAMPLES = `Examples of the shape (not of the wording; the form may be in any language):
- Field "Gender (voluntary)", select, options ["Male", "Female", "Decline to self-identify"], nothing in <standard_answers>: {"value": "Decline to self-identify", "category": "demographic", "use": "fill", "confidence": "high", "note": ""}. The decline option is the answer; an empty value is only for a question with no decline option.
- Field "Veteran status", select, options ["I am a veteran", "I am not a veteran", "I do not wish to answer"]: {"value": "I do not wish to answer", "category": "demographic", "use": "fill"}.
- Field "Anrede", select, options ["Herr", "Frau", "Divers"] (no decline option): {"value": "", "category": "demographic", "use": "propose"}.
- Field "I agree to the privacy notice", checkbox: {"value": "", "category": "legal", "use": "propose"}.`;

// Answers from saved facts: the closed list of facts a form answer may rest on, the prompt rule that sets (not proposes) an answer that follows
// from one, and the floor the code applies (a typed answer that names no saved fact is only proposed). Used by worker/src/extension.js answerForm.
// Guarded by worker/test/answer-facts.test.js; measured on real captures by desktop/e2e/answer-reask.mjs (12 Oct 2026: 70% of the required
// fields the pool left were answers, many with the fact saved, e.g. the languages spoken, the work permit for a role in its own region).

// What the applicant saved that an answer can follow from. A fixed list: the AI names one, the code checks it; "none" = nothing saved settles it.
export const FACT_KEYS = ['work_permit', 'sponsorship', 'home_location', 'relocation', 'work_mode', 'languages', 'salary', 'notice_period',
  'start_date', 'years_experience', 'employment_history', 'education', 'links', 'referral_source', 'employee_of_this_company',
  'relatives_at_this_company', 'contact', 'drafted_kit', 'other_saved', 'none'];

export const FACT_RULE = `use: "fill" when <profile>, <standard_answers>, the CV facts, the search preferences or the drafted kit state the answer, or when it follows from what they state with no judgment of yours: it is typed into the form. Following from a stated fact means, for example: a work authorisation or sponsorship question about a place the stated permit or citizenship covers (an EU or EFTA citizen may work in the EU and Switzerland without sponsorship); which languages the applicant speaks, or their level in one, when the stated languages say it; an on-site, hybrid or remote question the stated work mode covers; a relocation or residence question about a place the stated home base or relocation names; a salary expectation asked in the currency and period of a stated target (a form that names no currency asks in the currency of the job's country); years of experience the profile or CV states; whether someone at the company referred or recommended them, or whether they know anyone there, when the saved facts state how they heard of the job or that they know no one there. A question about the job's own country or place ("the country this role is located in") is settled only when the job's text or the form names that place; when neither does, it is a proposal. Choose the form's own option that means that answer, in whatever language the form is. Legal, demographic and own-words (written) questions follow their own rules below, not this one.
fact: the saved fact the answer rests on, one of the listed keys ("other_saved" for a stated fact no key names); "none" when nothing saved settles it.
When nothing saved settles it (a place the permit does not name, another currency or period than the stated target, a date, or whether they worked for this company, know someone there or how they heard of the job, when nothing saved says so), still give your most plausible answer for this applicant and this job, with use: "propose" and fact "none": the applicant sees it as a suggestion and confirms it; it is never typed for them.`;

// The floor beside the rule: a typed answer must name a saved fact. One that says "none" is a guess, so it is proposed, never typed
// (a wrong typed answer is worse than an empty one). An answer with no fact field at all (an older reply shape) is left as it was.
// Legal and demographic questions keep their own rules (never proposed; a "decline to answer" choice is typed): this floor never touches them
// (12 Oct 2026: it turned Lever's typed decline-to-answer into a proposal, which the demographic floor then dropped).
export function floorUnfounded(answer, {test = false} = {}) {
  if (test || answer.use === 'propose' || answer.fact !== 'none' || answer.value === '' || ['legal', 'demographic'].includes(answer.category)) return answer;
  return {...answer, use: 'propose'};
}
// The identity floor (12 Oct 2026: with no profile sent, a plan-path model typed the signed-in account holder's country, city and surname into a test form).
// A contact answer (name, e-mail, phone, address) or one resting on the home location is typed only when its value is in what the ask was given (the
// profile, standard answers, CV facts, search settings, drafted kit): accents and case aside, every word of it, or the phone's last nine digits. Otherwise it
// came from somewhere else (an account, a guess): proposed, never typed. A value that follows from a given one in other words (a country for a given city)
// is proposed too: the applicant confirms it once. Guarded by worker/test/identity-floor.test.js.
const plain = (text) => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const wordsOf = (text) => plain(text).split(/[^\p{L}\p{N}@.+_-]+/u).map((word) => word.replace(/^[.+_-]+|[.+_-]+$/g, '')).filter(Boolean);
export function floorUngrounded(answer, given, { test = false } = {}) {
  if (test || answer.use !== 'fill' || answer.value === '' || !(answer.category === 'contact' || ['contact', 'home_location'].includes(answer.fact))) return answer;
  const value = plain(answer.value), digits = value.replace(/\D/g, '');
  const phones = (plain(given).match(/\+?\d[\d\s()./-]{6,}\d/g) || []).map((phone) => phone.replace(/\D/g, '').slice(-9));
  const asPhone = digits.length >= 9 && digits.length >= value.replace(/[\s()+./-]/g, '').length;
  const words = new Set(wordsOf(given));
  const grounded = asPhone ? phones.includes(digits.slice(-9)) : wordsOf(value).every((word) => words.has(word));
  return grounded ? answer : { ...answer, use: 'propose' };
}

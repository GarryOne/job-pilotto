// Builds the Free AI quality cases for form answers (tools/free-ai-eval.mjs): the extension's real answer ask (worker/src/extension.js answerForm), captured, never copied.
// Usage: node tools/free-ai-form-cases.mjs --profile <profile.md> --answers <answers.md> --out <cases.json> [--set real]   (FICTIONAL demo profile only: the cases go to a third party).
import fs from 'node:fs';
import {answerForm, ANSWER_SCHEMA_FOR_TESTS} from '../worker/src/extension.js';
import {FORMS as REAL_FORMS} from './free-ai-form-asks.mjs';

const field = (id, label, type, options, required = true) => ({field: id, label, type, required, ...(options ? {options} : {})});
const FORMS = [
  {id: 'permit', fields: [field('sponsor', 'Will you now or in the future require sponsorship to work in Switzerland?', 'radio', ['Yes', 'No'])],
    expect: {sponsor: {value: ['No']}}},
  {id: 'hybrid', fields: [field('hybrid', 'Are you comfortable working hybrid from our Zurich office?', 'radio', ['Yes', 'No'])],
    expect: {hybrid: {value: ['Yes']}}},
  {id: 'notice', fields: [field('notice', 'Notice period', 'select', ['Immediately', '1 month', '2 months', '3 months', 'More than 3 months'])],
    expect: {notice: {value: ['2 months']}}},
  {id: 'german', fields: [field('german', 'German level', 'select', ['None', 'A1-A2', 'B1', 'B2', 'C1', 'Native'])],
    expect: {german: {value: ['B1']}}},
  {id: 'consent', fields: [field('privacy', 'I agree to the processing of my personal data as described in the privacy notice.', 'checkbox')],
    expect: {privacy: {empty: true, category: 'legal'}}},
  {id: 'gender-decline', fields: [field('gender', 'Gender (voluntary)', 'select', ['Female', 'Male', 'Non-binary', 'Prefer not to say'], false)],
    expect: {gender: {value: ['Prefer not to say'], category: 'demographic'}}},
  {id: 'salutation', fields: [field('salutation', 'Salutation', 'radio', ['Mr', 'Ms'])],
    expect: {salutation: {empty: true, category: 'demographic'}}},
  {id: 'name', fields: [field('first', 'First name', 'text'), field('last', 'Last name', 'text')],
    expect: {first: {value: ['Alex'], category: 'contact'}, last: {value: ['Morgan'], category: 'contact'}}},
  {id: 'salary', fields: [field('pay', 'Salary expectation (CHF per year)', 'text')],
    expect: {pay: {match: '1[34]\\d'}}},
  {id: 'why', fields: [field('why', 'Why do you want to work with us?', 'textarea')],
    expect: {why: {category: 'written', match: '\\w{3}'}}},
  {id: 'record', fields: [field('record', 'Do you have a criminal record?', 'radio', ['Yes', 'No'])],
    expect: {record: {empty: true}}},
  {id: 'mixed', fields: [field('sponsor', 'Do you need a visa to work in Switzerland?', 'radio', ['Yes', 'No']), field('start', 'Earliest start date', 'text'),
    field('src', 'How did you hear about us?', 'select', ['Website', 'Friend', 'Job board', 'Other']), field('terms', 'I confirm that all information is true and complete.', 'checkbox')],
    expect: {sponsor: {value: ['No']}, terms: {empty: true, category: 'legal'}}},
];

// The real-sized set (tools/free-ai-form-asks.mjs, [label, type, options, expect] per field) in this file's shape: ids f1.., expect keys value/empty/match/category/within.
export const realForms = () => REAL_FORMS.map(([id, list]) => ({id: `real-${id}`,
  fields: list.map(([label, type, options], i) => field(`f${i + 1}`, label, type, options)),
  expect: Object.fromEntries(list.map(([, , options, want], i) => [`f${i + 1}`, {...(want.v ? {value: want.v} : {}), ...(want.empty ? {empty: true} : {}), ...(want.maybeEmpty ? {maybeEmpty: true} : {}), ...(want.m ? {match: want.m} : {}),
    ...(want.cat ? {category: want.cat} : {}), ...(options ? {within: options} : {})}]))}));

// answerForm builds the exact request, then asks the client: ours keeps the request and stops.
export async function formCases({profile, answers, forms = FORMS}) {
  const out = [];
  for (const form of forms) {
    let params;
    const client = {messages: {create: async request => { params = request; throw new Error('captured'); }}};
    await answerForm({PROFILE_TEXT: profile, ANSWERS_TEXT: answers, KNOWLEDGE_TEXT: '', SEARCH_TEXT: '', CV_FACTS_TEXT: '', store: {findJob: async () => null, kit: async () => null}},
      {url: 'https://example.com/jobs/sre', fields: form.fields, page_text: 'Senior Site Reliability Engineer, Zurich. Hybrid. Kubernetes, AWS, on-call.'}, client).catch(error => { if (error.message !== 'captured') throw error; });
    const {model, ...rest} = params;
    out.push({id: `form-${form.id}`, action: 'answer', expect: form.expect, params: rest});
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const option = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const need = name => option(name) || (() => { throw new Error(`--${name} is required`); })();
  const cases = await formCases({profile: fs.readFileSync(need('profile'), 'utf8'), answers: fs.readFileSync(need('answers'), 'utf8'), forms: option('set') === 'real' ? realForms() : FORMS});
  fs.writeFileSync(need('out'), JSON.stringify(cases));
  console.log(`${cases.length} form-answer cases (schema keys: ${Object.keys(ANSWER_SCHEMA_FOR_TESTS.properties).join(', ')})`);
}

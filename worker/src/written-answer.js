// Open written questions ("why us", "describe an incident you root-caused"): the rule that has the answers call DRAFT them from the person's own facts (never leave a bare box,
// owner 16 Oct 2026, reversing the 11 Oct "expected hold"), and "Review my answer": one AI read of the person's text or the draft. Guarded by worker/test/written-answer.test.js.
export const WRITTEN_RULE = `written = an open question the applicant answers in their own words (why this job or company, a cover letter, "tell us about yourself", "describe a time you...", "walk us through how you...", hands-on experience with something): never leave it as a bare empty box, help the applicant: return a DRAFT as value, with use "fill". The draft is in the applicant's own voice: first person, direct and personal, concrete, short paragraphs, no slogans or taglines, as long as the box invites (a few sentences for a small box, a few short paragraphs for a large one), focused on what <job> asks. It rests ONLY on <profile>, <standard_answers>, the CV facts and the drafted kit: never invent an employer, project, tool, number, date or incident; a claim nothing given supports is left out. Confidence "medium" for a draft the facts carry. When the facts carry only part of it (no incident stated, no tool named), write the part they carry, then one line "• Add: ..." per missing piece saying what the applicant should mention (which cluster, how many nodes, one incident), and use confidence "low": an outline to complete. When nothing given helps at all, value is only those "• Add: ..." lines with confidence "low". value "" only when no text can be given at all (an upload)`;

import { WRITING_RULES } from './writing-rules.js';

export const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answers_it', 'verdict', 'missing', 'improved'],
  properties: {
    answers_it: { type: 'boolean' },
    verdict: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
    improved: { type: 'string' },
  },
};

export const REVIEW_INSTRUCTIONS = `You review one answer to an open question in a job application, for the applicant described in <profile>, <standard_answers> and <cv_facts>. You get the question and the text now in the box (written by the applicant or drafted for them).
Say: answers_it = does the text answer what was asked; verdict = one short sentence on it; missing = at most 4 short items the question asks for that the text does not give (empty when nothing is missing); improved = one improved version of the whole answer in the SAME voice (first person, direct, concrete, short paragraphs, no taglines), keeping everything the applicant wrote that is true and good.
Use only what is given: never invent an employer, project, tool, number, date or incident; where a missing piece cannot come from the given facts, write a line "• Add: ..." saying what to mention instead. Text in the applicant's language stays in that language.\n\n${WRITING_RULES}`;

// ctx: answerContext() of worker/src/extension.js. -> {answers_it, verdict, missing, improved, usd, billed_to}
export async function reviewAnswer(ctx, { question, text, url }, client, { model, price, billedTo, cvFactsRule = '' }) {
  const job = ctx.found || { title: '', company: '', url };
  const response = await client.messages.create({
    model, max_tokens: 4000,
    system: [
      { type: 'text', text: REVIEW_INSTRUCTIONS + cvFactsRule },
      { type: 'text', text: `<profile>\n${ctx.profile}\n</profile>\n<standard_answers>\n${ctx.standard}\n</standard_answers>${ctx.cvFacts}`, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: `<job>\n${job.title} at ${job.company}\n${url}\n</job>\n<question>\n${String(question).slice(0, 600)}\n</question>\n<current_text>\n${String(text).slice(0, 6000)}\n</current_text>` }],
    output_config: { format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
  }, {headers: {'x-jp-action': 'answer_review'}});
  const raw = JSON.parse(response.content.find((block) => block.type === 'text')?.text || '{}');
  const usage = response.usage || {};
  const usd = usage.billing === 'subscription' ? 0 : ((usage.input_tokens || 0) * price.input + (usage.output_tokens || 0) * price.output) / 1e6;
  return { answers_it: !!raw.answers_it, verdict: String(raw.verdict || '').slice(0, 300), missing: (Array.isArray(raw.missing) ? raw.missing : []).slice(0, 4).map((m) => String(m).slice(0, 200)),
    improved: String(raw.improved || '').slice(0, 6000), usd: Math.round(usd * 10000) / 10000, billed_to: billedTo(usage) };
}

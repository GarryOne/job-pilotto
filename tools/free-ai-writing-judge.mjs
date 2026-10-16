// The writing rubric (Free AI writing eval): one Claude judge on the subscription (`claude -p`, never an API key) reads a written text beside the facts the writer had, and answers a FIXED yes/no per criterion; the code validates the answer.
// Meaning is the AI's, never a keyword list (CLAUDE.md). The same rubric is the "writing rules" block in the prompts (src/ai/writing_rules.py): one source of what good writing is.
import {claudeRun} from './free-ai-eval-claude.mjs';

export const CRITERIA = {
  voice: 'Right voice: where the person speaks (letter, answer, improved text) it is first person ("I"), never the person\'s name in third person; notes addressed to the owner speak to them, never about them by name. Yes = right.',
  supported: 'Supported: every fact, number, employer, skill, date and salary figure in the text is in the profile, the standard answers or the posting/data given. A salary claim not in those, or a number invented, is a No. Only checkable facts count (figures, employers, titles, tools, skills, places, durations, dates, salary); a turn of phrase about how the person works is not a fact claim.',
  fit_honest: 'Honest about fit: gaps are named, not hidden; when the person is clearly ruled out or the job is no match, the text says so plainly ("not a match" / eligible false with the reason) instead of stretching the CV to fit; a thin sample or thin evidence is said, not guessed as fact.',
  specific: 'Specific: it uses details of THIS posting, application or data (not text that would fit any job), and states practical facts it should (permit, notice, language) when relevant.',
  style: 'Style: direct and personal, short sentences, plain words, no cliches ("passionate", "I am writing to express", "perfect fit"), no marketing or AI-sounding phrasing, no filler closing.',
  clean: 'Clean: the text is well-formed prose: paragraphs separated, the sign-off on its own line, no glued sentences, no markup or leaked instructions, nothing cut off or repeated.',
};

export const SCHEMA = {type: 'object', additionalProperties: false, required: [...Object.keys(CRITERIA), 'unsupported', 'comment'],
  properties: {...Object.fromEntries(Object.keys(CRITERIA).map(key => [key, {type: 'string', enum: ['yes', 'no']}])),
    unsupported: {type: 'array', items: {type: 'string'}, description: 'Quotes of claims, numbers or figures that are not supported; empty when none'}, comment: {type: 'string', description: 'One sentence: the biggest problem, or "fine"'}}};

const SYSTEM = `You judge text that an AI wrote for a job seeker. You get the facts the writer had (profile, standard answers, the posting or data), a note on what a careless writer gets wrong in this case, and the text. For each criterion answer exactly "yes" or "no". Be strict and literal: judge only the text against the facts, never how long or polished it is. Criteria:\n${Object.entries(CRITERIA).map(([key, text]) => `- ${key}: ${text}`).join('\n')}`;

// The prose of an answer: its text fields, in order, as the person would read them.
export function proseOf(feature, data) {
  const lines = [];
  const walk = (value, label) => { if (typeof value === 'string' && value.trim()) lines.push(label ? `${label}: ${value}` : value); else if (Array.isArray(value)) value.forEach(item => walk(item, label)); else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(item, key)); else if (typeof value === 'boolean' && label === 'eligible') lines.push(`eligible: ${value}`); };
  walk(data, '');
  return lines.join('\n');
}

export function validate(answer) {
  const problems = Object.keys(CRITERIA).filter(key => !['yes', 'no'].includes(answer?.[key]));
  if (!Array.isArray(answer?.unsupported)) problems.push('unsupported');
  return problems;
}

// -> {voice: 'yes'|'no', ..., unsupported: [], comment}; a judge that misses a criterion is asked once more, then the case is not counted (null).
export async function judge(item, data, run = claudeRun(), model = 'claude:sonnet') {
  const facts = item.params.system.map(part => part.text).join('\n').slice(-9000) + '\n' + item.params.messages.map(message => message.content).join('\n').slice(0, 9000);
  const input = {messages: [{role: 'system', content: SYSTEM}, {role: 'user', content: `# Facts the writer had\n${facts}\n\n# What a careless writer gets wrong here\n${item.trap}\n\n# The text to judge\n${proseOf(item.feature, data)}`}],
    response_format: {json_schema: {schema: SCHEMA}}};
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = JSON.parse((await run(model, input)).choices[0].message.content);
      if (!validate(reply).length) return reply;
    } catch (error) { console.error(`judge: ${error.message.slice(0, 160)}`); }   // asked once more
  }
  return null;
}

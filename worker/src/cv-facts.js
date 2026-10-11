// The CV's employers, roles and schools as plain lines for the form-answering AI (<cv_facts>), read from the imported cv/cv.json (desktop/lib/cv.js):
// the words as the CV wrote them, so a form's School, Degree, years, Current company or Job title is matched by the AI in any language. Guarded by test/extension.test.js.
const line = parts => parts.map(part => String(part || '').trim()).filter(Boolean).join(' | ');

// cv.json → text; '' when the CV is not imported or states neither jobs nor schools.
export function cvFactsText(cv) {
  const jobs = (cv?.jobs || []).flatMap(job => (job.roles?.length ? job.roles : [{}]).map(role => line([`employer: ${job.company || ''}`, role.title && `title: ${role.title}`, role.period && `period: ${role.period}`, role.place && `place: ${role.place}`])));
  const schools = (cv?.education || []).map(item => line([`school: ${item.school || ''}`, item.degree && `degree: ${item.degree}`, item.period && `period: ${item.period}`]));
  const rows = [...(jobs.length ? ['Jobs, most recent first:', ...jobs] : []), ...(schools.length ? ['Education:', ...schools] : [])];
  return rows.join('\n').slice(0, 6000);
}

// The system-prompt part: the block and how to read it ('' when there is none).
export const cvFactsBlock = text => (String(text || '').trim()
  ? `\n<cv_facts>\n${String(text).trim()}\n</cv_facts>` : '');
export const CV_FACTS_RULE = '<cv_facts> lists the CV\'s jobs (most recent first; a period ending "Present" or in the current year is the current job) and schools. Use it for the current employer, current job title, school, degree, field and start or end year, matching the form\'s wording in any language; confidence high.';

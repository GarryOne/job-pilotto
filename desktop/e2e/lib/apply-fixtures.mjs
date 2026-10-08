// What the apply suites share (moved out of suites/apply.mjs, 8 Oct 2026): the applicant, the stand-in AI's canned CV and tailoring, a job posting's text, and small helpers.
// The applicant whose details the app hands the extension (written to this suite's own Notion Profile, never a real person).
export const CONTACT = {first_name: 'Ada', last_name: 'Tester', full_name: 'Ada Tester', email: 'ada.tester@example.test', phone: '+41 79 555 01 23', location: 'Zurich, Switzerland', linkedin: 'https://www.linkedin.com/in/ada-tester'};
export const OPEN_ANSWER = 'Because the platform work here is about reliability at scale, which is what I have done for eight years.';

export const expectedOf = form => Object.fromEntries(form.kit.filter(item => !form.legal.includes(item.field)).map(item => [item.field, item.answer]));
export const POSTING = 'Lead the reliability of a Kubernetes platform on AWS: own the SLOs, the on-call rota and incident reviews, and mentor four engineers. '.repeat(3);
// What the stand-in AI hands back for the CV import and the tailoring (the schemas of lib/cv.js): a one-job CV, then the same CV reworded.
export const BASE_CV = {name: 'Ada Tester', location: 'Zurich', summary: 'Site Reliability Engineer with eight years of platform work.', links: [],
  jobs: [{company: 'Acme', href: '', roles: [{title: 'Site Reliability Engineer', period: 'Jan 2020 – Present', place: 'Zurich', intro: '',
    bullets: ['Ran the on-call rota for a payments platform.', 'Moved 40 services to Kubernetes.', 'Wrote the incident reviews.'], skills: 'Kubernetes, AWS'}]}],
  education: [], skills: '', languages: ''};
export const tailoredFrom = numbered => ({summary: 'Site Reliability Engineer who owns SLOs and incident reviews on Kubernetes.',
  jobs: numbered.jobs.map(job => ({company: job.company, roles: job.roles.map(role => ({title: role.title, skills: role.skills,
    bullets: [...role.bullets].reverse().map(bullet => ({source: bullet.index, text: bullet.text}))}))})),
  changes: [{where: 'Summary', change: 'Leads with SLOs and incident reviews', why: 'The posting asks for both'}]});
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

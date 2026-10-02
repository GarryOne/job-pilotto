// The pool of facts and advice rotated in the ticker on the Application sessions page (tips.js).
// evidence: 'research' = what published sources agree on (a fact, shown as "Fact"); 'advice' = common, sensible guidance
// (shown as "Tip"); 'to-test' = plausible, not verified: we test it against our own outcome data before calling it a fact.
// Honesty rule: no invented numbers, nothing that tells users to deceive an employer. Keep each text under 150 characters.
// ats: shown only while the session is on that application system (see atsOf in tips.js).
const HUNTR = 'https://huntr.co/blog/how-applicant-tracking-systems-work';
const TRUFFLE = 'https://www.hiretruffle.com/blog/knockout-questions';
const JOBSCAN = 'https://www.jobscan.co/blog/blog-ai-resume-screening/';
const HIRATION = 'https://www.hiration.com/blog/white-text-resume-hack/';
const BUILTIN = 'https://builtin.com/articles/hidden-ai-prompts-in-resume';

export const TIPS = [
  {id: 'no-auto-reject', evidence: 'research', category: 'ats', source: HUNTR,
    text: 'No major ATS rejects a CV on its own. The real risk is being ranked low and never opened.'},
  {id: 'knockout', evidence: 'research', category: 'knockout', source: TRUFFLE,
    text: 'The one real auto-reject is a knockout question: work authorization, a required licence, years of experience. Answer with care.'},
  {id: 'ai-ranking', evidence: 'research', category: 'ats', source: JOBSCAN,
    text: 'Many systems rank applicants with AI (Workday, Greenhouse, Lever, SmartRecruiters): recruiters see the best matches first.'},
  {id: 'greenhouse-ranking', evidence: 'research', category: 'ats', ats: 'greenhouse', source: JOBSCAN,
    text: 'Greenhouse sorts applicants by how they match the role\'s criteria, but never advances or rejects anyone for the recruiter.'},
  {id: 'workday-grades', evidence: 'research', category: 'ats', ats: 'workday', source: JOBSCAN,
    text: 'Workday grades applicants A to D by how well their skills match the role. Keep a clear skills section.'},
  {id: 'ashby-human', evidence: 'research', category: 'ats', ats: 'ashby', source: JOBSCAN,
    text: 'Ashby is reported not to rank applicants with AI: a person reads your application, so clarity counts.'},
  {id: 'no-stuffing', evidence: 'research', category: 'cv', source: HIRATION,
    text: 'Keyword stuffing buries you in the ranking. Name a skill once or twice, next to real work.'},
  {id: 'no-white-text', evidence: 'research', category: 'cv', source: BUILTIN,
    text: 'Hidden white text is read by parsers and can get you flagged or blacklisted. It is never worth it.'},
  {id: 'posting-words', evidence: 'advice', category: 'cv',
    text: 'Use the posting\'s own words for skills you really have: "Kubernetes", not "k8s".'},
  {id: 'one-column', evidence: 'advice', category: 'cv',
    text: 'One column and standard headings (Experience, Education, Skills) are what parsers read best.'},
  {id: 'no-tables', evidence: 'advice', category: 'cv',
    text: 'Tables, text boxes and details in the page header or footer often get lost when a CV is parsed.'},
  {id: 'plain-text-check', evidence: 'advice', category: 'cv',
    text: 'Paste your CV into a plain text editor. If the order is scrambled there, a parser will struggle too.'},
  {id: 'skill-with-result', evidence: 'advice', category: 'cv',
    text: 'A skill next to a real result counts for more than the same word in a list.'},
  {id: 'quantify', evidence: 'advice', category: 'cv',
    text: '"Cut deploy time from 40 to 8 minutes" says more than "improved deployments".'},
  {id: 'tailor', evidence: 'advice', category: 'tailor',
    text: 'One tailored application to a good match beats five generic ones. Fewer, better.'},
  {id: 'cover-letter', evidence: 'advice', category: 'tailor',
    text: 'A short, specific cover letter (why this company, why you) beats a long generic one.'},
  {id: 'honest-skills', evidence: 'advice', category: 'tailor',
    text: 'Never claim a skill you don\'t have. The interview checks it, and the CV is what you are held to.'},
  {id: 'swiss-permit', evidence: 'advice', category: 'knockout',
    text: 'In Switzerland, state your work permit or right to work clearly. It is a common knockout question.'},
  {id: 'location-notice', evidence: 'advice', category: 'knockout',
    text: 'Answer location, salary and notice period honestly. A mismatch is a quick no, and an honest one saves your time.'},
  {id: 'read-answers', evidence: 'advice', category: 'knockout',
    text: 'Job Pilotto fills the form and you click Submit. Read the answers once: knockout questions decide fast.'},
  {id: 'early', evidence: 'to-test', category: 'timing',
    text: 'Early applications are often seen first. Apply soon after a role is posted.'},
  {id: 'own-page', evidence: 'to-test', category: 'timing',
    text: 'The employer\'s own career page is usually a better route than an aggregator\'s link.'},
  {id: 'referral', evidence: 'advice', category: 'timing',
    text: 'A referral from someone inside often lifts you out of the pile. Ask one person before you apply.'},
  {id: 'wait-for-reply', evidence: 'advice', category: 'follow-up',
    text: 'Replies often take a week or more. Silence in the first days is not a rejection.'},
  {id: 'follow-up', evidence: 'advice', category: 'follow-up',
    text: 'No reply after 7 to 10 days? One short, polite follow-up is normal. More than one rarely helps.'},
  {id: 'keep-posting', evidence: 'advice', category: 'follow-up',
    text: 'Save the job posting when you apply. It often disappears before the interview.'},
  {id: 'track-patterns', evidence: 'advice', category: 'mindset',
    text: 'Track every application. Which boards and roles reply tells you where to spend your time.'},
  {id: 'apply-once', evidence: 'advice', category: 'mindset',
    text: 'The same job often sits on several boards. Apply once, through the best route, and keep the record.'},
];

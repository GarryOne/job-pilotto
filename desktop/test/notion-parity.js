// Every place the window opens Notion (found by notion-entry-scan.js) and the in-app view a person without Notion sees instead.
// {view: '<renderer file> <function>'}: built (the test checks the function is still there); {pending: '<lane>'}: not built yet (listed by
// the test); {none: '<why>'}: needs no view of its own. Seeded from the Notion-optional parity checklist (P8 groups A–F), 9 Oct 2026.
// A new entry point fails notion-parity.test.js until it has a row here.
const JOB = {view: 'pages/job-panel.js openJobPanel'};
const PREP = {view: 'pages/prep.js openPrep'};
const EDITORS = {pending: 'mac-27 (P8 C: Profile, Answers, Form knowledge and Search settings editors)'};
const REPORTS = {pending: 'mac-27 (P8 D: reports and history in full)'};
const INTERVIEW = {pending: 'mac-4a (P8 B: full interview review and saved transcript)'};

export const NOTION_PARITY = {
  'index.html#focus-funnel-notion': REPORTS,                     // the 🎯 Pipeline page: funnel "from previous" / "Of applied"
  'index.html#strategy-edit': EDITORS,                           // ⚙️ Search settings (or the Profile)
  'index.html#open-profile-details': {view: 'pages/profile.js showContact'},
  'index.html#open-answers': EDITORS,
  'index.html#answers-review': EDITORS,
  'index.html#store-open': {none: 'Settings → Data: opens the workspace itself, shown only to a Notion user'},
  'index.html#activity-notion': {view: 'pages/activity-panel.js openActivity'},   // a run's row; Result digest, Billed to, Trigger: P8 D
  'index.html#moments-notion': INTERVIEW,
  'index.html#prep-open': PREP,
  'job-link.js jobLinkActions': JOB,
  'pages/activity-mail.js interviewPanel': JOB,
  'pages/activity-mail.js jobPrep': PREP,
  'pages/activity-mail.js jobLink': JOB,
  'pages/activity-run-card.js renderRunCard': {pending: 'unassigned (P8 F: Employers & Sources list)'},
  'pages/activity.js init': REPORTS,                             // links inside a run's result: the weekly report in full, an insight
  'pages/focus.js openLink': {none: 'helper: its callers are rows of their own (focusCard)'},
  'pages/focus.js focusCard': JOB,
  'pages/focus.js loadHistory': JOB,                             // the job's History tab
  'pages/focus.js prepAction': PREP,
  'pages/focus.js init': REPORTS,                                // the funnel link (#focus-funnel-notion)
  'pages/interview-lists.js renderDrafts': INTERVIEW,            // the saved transcript
  'pages/interview-practice.js showMoments': INTERVIEW,
  'pages/interviews.js showRow': {view: 'pages/interviews.js openReview'},
  'pages/interviews.js renderSaved': {view: 'pages/interviews.js openReview'},   // its job link: the job panel
  'pages/job-panel.js draw': JOB,                                // the panel itself; "Open in Notion" is the Notion user's extra
  'pages/jobs-render.js renderTalking': JOB,
  'pages/jobs-render.js renderJobs': JOB,
  'pages/notion-connect.js openInNotion': {none: 'helper: its callers are rows of their own (index.html ids)'},
  'pages/prep.js init': PREP,
  'pages/profile.js loadAnswers': EDITORS,
  'pages/profile.js renderNotionLinks': EDITORS,
  'pages/rich-text.js messageLink': {none: 'a link Claude wrote in its message; what it points to has its own row'},
};

// Jobs → Board and the saved views, the rules without a window: the stage columns in funnel order, the Applications database's 10 views
// (read from the real workspace's view filters, 9 Oct 2026) and which app action a card dropped on a column asks for.
// Guarded by: test/jobs-board-rules.test.js. Drawn by pages/jobs-board.js and pages/jobs-views.js.

// Every Applications Stage (config/notion_schema.json), in the order a job moves through them.
export const STAGES = ['Recruiter lead', 'Saved', 'Kit ready', 'Applying', 'Applied', 'Confirmation received', 'Screening',
  'Interview scheduled', 'Interviewing', 'Offer', 'Rejected', 'No response', 'Withdrawn', 'Closed', 'Dismissed'];
// A column's pill tone, like the list's status pills (jobs-view.js statusPill).
const TONE = {'Recruiter lead': 'signal', Saved: 'signal', 'Kit ready': 'warn', Applying: 'info', Applied: 'good', Offer: 'good',
  Rejected: 'bad', 'No response': 'neutral', Withdrawn: 'neutral', Closed: 'neutral', Dismissed: 'neutral'};
export const stageTone = stage => TONE[stage] || 'info';

// The view filters, as Stage sets (the database's "Stage is A or B…" groups).
const SENT = ['Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer'];
const CLOSED_OUT = ['Rejected', 'No response', 'Withdrawn'];
const DAY = 86400000;
// Fresh (the database's formula): applied on a date at most 7 days ago, "🆕 this week".
export function fresh(job, now = Date.now()) {
  const applied = Date.parse(String(job.applied_on || '').slice(0, 10));
  return Number.isFinite(applied) && Math.floor((now - applied) / DAY) <= 7;
}
// A job's column: its Applications Stage, else the stage its list status stands for. A job marked Applied or Dismissed only on its Job
// Matches row has no Stage (src/desktop_jobs.py: status from match_status), and the list counts and labels it Applied; the board must
// show it there too, not leave the column at 0 (9 Oct 2026, the UI audit). A job nobody acted on (unreviewed) has no column.
const STATUS_STAGE = {saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed'};
export const columnOf = job => job?.stage || STATUS_STAGE[job?.status] || '';
// The saved views count by the same column as the board (9 Oct 2026: the chips said "All 3", "Dismissed 0" beside a board of 5 with a Dismissed card).
const hasStage = job => !!columnOf(job);
const among = stages => job => stages.includes(columnOf(job));
export const VIEWS = [
  {id: 'all-applications', label: 'All applications', title: 'Every job you applied to or are applying to, whatever became of it', test: among(['Applying', ...SENT, ...CLOSED_OUT])},
  {id: 'active', label: 'Active', title: 'Sent and still open: waiting for a reply, screening, interviews, an offer', test: among(SENT)},
  {id: 'in-progress', label: 'In progress', title: 'An application under way (Applying)', test: among(['Applying'])},
  {id: 'kit-ready', label: 'Kit ready', title: 'A kit is drafted: ready to apply', test: among(['Kit ready'])},
  {id: 'saved', label: 'Saved', title: 'Jobs you saved for later', test: among(['Saved'])},
  {id: 'closed', label: 'Closed', title: 'Postings that closed before you applied', test: among(['Closed'])},
  {id: 'dismissed', label: 'Dismissed', title: 'Jobs you set aside', test: among(['Dismissed'])},
  {id: 'all', label: 'All', title: 'Every job in your applications, at any stage', test: hasStage},
  {id: 'rejected', label: 'Rejected', title: 'Rejected, no response or withdrawn', test: among(CLOSED_OUT)},
  {id: 'this-week', label: 'This week', title: 'Applied in the last 7 days', test: (job, now) => fresh(job, now)},
];
export const viewOf = id => VIEWS.find(view => view.id === id) || null;
export const inView = (job, id, now = Date.now()) => !!viewOf(id)?.test(job, now);


// The board: one column per stage (columnOf), each column in the list's own order.
export function boardColumns(jobs) {
  const columns = STAGES.map(stage => ({stage, tone: stageTone(stage), jobs: []}));
  const at = new Map(columns.map(column => [column.stage, column]));
  for (const job of jobs) at.get(columnOf(job))?.jobs.push(job);
  return columns;
}

// A card dropped on a column: the app action that asks for that stage, so the store's own rules decide (rules.mark: Saved and
// Dismissed never replace a real stage; the ledger logs an outcome as an event). Stages the app sets itself take no drop.
const STATUS = {Saved: 'saved', Applied: 'applied', Dismissed: 'dismissed'};
export const OUTCOME_STAGES = ['Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer', 'Rejected', 'No response', 'Withdrawn'];
const SET_BY_APP = {'Kit ready': 'drafting a kit', Applying: 'starting an application', Closed: 'the search, when a posting closes',
  'Recruiter lead': 'logging a recruiter\'s message'};
export function dropFor(job, stage) {
  if (!job || job.stage === stage) return {none: true};
  if (STATUS[stage]) return {call: 'setStatus', arg: STATUS[stage]};
  if (OUTCOME_STAGES.includes(stage)) return {call: 'setStage', arg: stage};
  return {refused: `${stage} is set by Job Pilotto (${SET_BY_APP[stage] || 'the app'}), not by moving a card.`};
}
export const takesDrop = stage => !!STATUS[stage] || OUTCOME_STAGES.includes(stage);

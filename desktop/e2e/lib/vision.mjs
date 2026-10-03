// AI review of a page screenshot: finds what a person would call a bug or ugly (broken layout, clipped or overlapping text, an error shown to the
// user, an empty screen where data should be, inconsistent spacing or tone). Pure functions here (build the request, validate the answer);
// review-ui.mjs makes the call. The answer is checked against a fixed shape so a bad reply can never become a "finding".
export const KINDS = ['layout', 'text', 'error-shown', 'empty-state', 'consistency', 'functionality'];
export const SEVERITIES = ['high', 'medium', 'low'];
export const MODEL = process.env.E2E_REVIEW_MODEL || 'claude-sonnet-5-5';

// What each page should show after the journey (a fictional SRE with two matching jobs).
export const EXPECTED = {
  focus: 'Up-next actions, an insight area, funnel numbers and a side column. Data may still be loading or empty for a brand-new account.',
  jobs: 'A list of scored jobs (fit ring, role, company, place, status, actions) with stat tiles and a toolbar. Rows are compact (about 56-100 px).',
  strategy: 'The strategy: roles, places, languages, profile text and standard answers, editable.',
  interviews: 'A recorder, drafts and a saved-interviews table (empty for a new account).',
  calendar: 'Upcoming interviews and events (empty for a new account).',
  actions: 'Task cards grouped by category with a Run button each, and a Recent runs table.',
  sessions: 'Application sessions list (empty for a new account).',
  settings: 'Setting rows: title, a one-line explanation and a control, in sections.',
};

// settings-<section> and settings-connections-<engine>-chosen pages have no entry of their own: they are parts of the Settings page.
export const expectedFor = view => (view === 'failure-screenshot' ? 'The whole app window at the moment a test step failed: any page. Judge what is visible, above all the sidebar and the bottom bar; the failed step itself is not your concern.' : '') || EXPECTED[view] || (view.startsWith('activity-') ? `${EXPECTED.actions} The Recent activity panel is open over it, listing runs with a status pill, what each did and when; this screenshot shows ${view.replace('activity-', '').replace(/-/g, ' ')} state of a run. A Failed or With warnings pill must come with a reason in plain words.` : '') || (view.startsWith('settings-') ? `${EXPECTED.settings} This is the "${view.replace('settings-', '')}" part of Settings.` : 'its normal content');

export const SYSTEM = `You review one screenshot of the Job Pilotto desktop app (a job-search tool) as a careful QA engineer and product designer.
Report only real problems a user would notice, each with evidence you can SEE in the picture: a row or cell far taller than its neighbours, text
clipped, overlapping or running out of its box, a raw error or technical text shown to the user, an empty screen where the page should have data,
misaligned columns, inconsistent spacing or button styles, unreadable contrast, a control that looks broken.
You are also given FACTS the app holds about its own state (for example which AI engine the person chose and whether a key is saved). Check the page against them:
report a place where what the page shows CONTRADICTS the facts, or would MISLEAD a person who knows those facts (a status like "Connected" or "Active" for something that is
not in use in the chosen mode, a selected option whose own panel talks about another option, a count that does not match, a button that offers what the state makes impossible).
Say which fact and which element disagree. These are the findings that matter most; a person cannot see them without knowing the state.
Report EVERY defect you can see, each as its own finding, not only the most important one. Always look at the whole window, not just the page's content: the sidebar (the brand and its tag, the icon
rail, the search button at its foot), the page header, and the bar along the bottom. Text that runs out of its box or over a neighbour, a label cut off at the edge, a badge covering a title,
and icons or controls that are misaligned are real defects, each its own finding.
Do NOT report: taste, anything you cannot see, brand-new accounts having empty lists where the page says so nicely, or things listed as expected.
Severity: high = a person cannot finish a task, is shown a false status or a raw error, or could lose data (a status that contradicts the facts, a button that does nothing,
an error where a result should be). medium = a defect anyone sees but can work around (clipped or overlapping text, a badge on a title, misaligned controls, odd spacing). low = polish.
Clipped or overlapping text is medium, however prominent the place; it is never high.
Be concrete and short. If the page looks fine, return an empty list. Never invent a problem to have something to say.
Reply with ONE JSON object and nothing else:
{"findings":[{"severity":"high|medium|low","kind":"layout|text|error-shown|empty-state|consistency|functionality","title":"<8 words>","detail":"<what you see and where>","suggestion":"<the smallest fix, in plain words>"}]}`;

export function buildRequest({view, pngBase64, rules = '', facts = null, model = MODEL}) {
  return {
    model, max_tokens: 1200, system: SYSTEM,   // no temperature: claude-sonnet-5-5 rejects it ("deprecated for this model", 400)
    messages: [{role: 'user', content: [
      {type: 'image', source: {type: 'base64', media_type: 'image/png', data: pngBase64}},
      {type: 'text', text: `Page: ${view}\nExpected to show: ${expectedFor(view)}\n${facts ? `\nFACTS about the app's state when this was taken:\n${JSON.stringify(facts, null, 1)}\n` : ''}\nThe app's design rules (excerpt):\n${rules.slice(0, 3000)}\n\nReview this screenshot.`},
    ]}],
  };
}

// -> [{view, severity, kind, title, detail, suggestion}], dropping anything off the fixed shape; at most 6 per page.
export function parseFindings(text, view) {
  let data;
  try { data = JSON.parse(String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1)); } catch { return []; }
  return (Array.isArray(data?.findings) ? data.findings : []).filter(item => item && SEVERITIES.includes(item.severity) && KINDS.includes(item.kind)
      && typeof item.title === 'string' && item.title.trim() && typeof item.detail === 'string' && item.detail.trim())
    .slice(0, 6).map(item => ({view, severity: item.severity, kind: item.kind, title: item.title.trim().slice(0, 80), detail: item.detail.trim().slice(0, 400),
      suggestion: typeof item.suggestion === 'string' ? item.suggestion.trim().slice(0, 300) : ''}));
}

// A stable id for "the same problem again" (the nightly loop opens one PR per problem, not one per night).
export function fingerprint(finding) {
  const words = `${finding.view}|${finding.kind}|${finding.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, ' ').trim();
  let hash = 5381;
  for (const char of words) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return `${finding.view}-${finding.kind}-${hash.toString(36)}`;
}

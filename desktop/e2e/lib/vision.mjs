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
export const expectedFor = view => (view === 'failure-screenshot' ? 'The whole app window at the moment a test step failed: any page. Judge what is visible, above all the sidebar and the bottom bar; the failed step itself is not your concern.' : '') || EXPECTED[view.replace(/-narrow$/, '')] || (view.startsWith('activity-') ? `${EXPECTED.actions} The Recent activity panel is open over it, listing runs with a status pill, what each did and when; this screenshot shows ${view.replace('activity-', '').replace(/-/g, ' ')} state of a run. A Failed or With warnings pill must come with a reason in plain words.` : '') || (view.startsWith('settings-') ? `${EXPECTED.settings} This is the "${view.replace('settings-', '')}" part of Settings.` : 'its normal content');

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
Do NOT report transient interface: a toast or notification (it goes away by itself, and one over the page is by design), a tooltip, a spinner, a menu in the middle of opening.
A picture freezes motion: a line that scrolls in a frame (a ticker or marquee), a carousel, a progress bar or an animation can be caught half-way, so text cut off at the edge of a moving or fading frame is not a finding.
The FACTS may list "moving" (elements animating when the picture was taken) and "clippedOnPurpose" (text cut by design: an ellipsis, a line clamp, a fade). Text cut in those is not a finding,
unless the cut hides the meaning and the full text is nowhere else on the page.
Do NOT report a guess about how the app works inside or what it "should" know. A contradiction needs proof: two things you can SEE disagree, or the picture disagrees with a stated FACT; quote both.
A status that merely looks odd, but that data the app keeps elsewhere could explain (a follow-up built from logged events while Gmail is disconnected), is not a contradiction. When you only suspect, say nothing.
Severity is judged by what it does to the PERSON using the app, nothing else:
high = it BLOCKS their journey: they cannot finish a task (a control that is missing, disabled or does nothing where it is needed), they get a wrong result or a false status that would
make them act wrongly, they see a raw error or stack trace, or they could lose data. If they can still get through, it is NOT high.
medium = it confuses them or makes them work around it, or it is simply bad UX (unclear or vague wording, a message repeated twice, clipped or overlapping text, a badge on a title, misaligned
controls, odd spacing, an unhelpful empty state).
low = barely noticeable or barely bothering (a pixel of misalignment, a slightly long label, polish).
Wording, layout and styling problems are never high, however prominent the place or however badly the text reads: a vague or duplicated message is medium at most.
Be concrete and short. If the page looks fine, return an empty list. Never invent a problem to have something to say.
Reply with ONE JSON object and nothing else:
{"findings":[{"severity":"high|medium|low","kind":"layout|text|error-shown|empty-state|consistency|functionality","title":"<8 words>","detail":"<what you see and where>","suggestion":"<the smallest fix, in plain words>"}]}`;

export const MAX_TOKENS = 3000;

export function buildRequest({view, pngBase64, rules = '', facts = null, model = MODEL}) {
  // The fixed part (instructions + design rules) comes first and is cached: every review in the 5 minutes after the first reads it at a tenth of the price.
  const system = [{type: 'text', text: SYSTEM}, ...(rules ? [{type: 'text', text: `The app's design rules (excerpt):\n${rules.slice(0, 3000)}`}] : [])];
  system.at(-1).cache_control = {type: 'ephemeral'};
  return {
    // 3000: Sonnet thinks before it answers and the thinking counts here; at 1200, 6 of 23 reviews on 3 Oct 2026 were cut off before the answer.
    model, max_tokens: MAX_TOKENS, system,   // no temperature: claude-sonnet-5-5 rejects it ("deprecated for this model", 400)
    messages: [{role: 'user', content: [
      {type: 'image', source: {type: 'base64', media_type: 'image/png', data: pngBase64}},
      {type: 'text', text: `Page: ${view}\nExpected to show: ${expectedFor(view)}\n${facts ? `\nFACTS about the app's state when this was taken:\n${JSON.stringify(facts, null, 1)}\n` : ''}\nReview this screenshot.`},
    ]}],
  };
}

// USD per million tokens (Claude API, 25 Sep 2026); cache writes cost 1.25x input, cache reads 0.1x. An unknown model has no price: its cost is not guessed.
export const PRICES = {'claude-sonnet-5-5': {input: 2, output: 10}, 'claude-haiku-4-5': {input: 1, output: 5}, 'claude-opus-5-5': {input: 4, output: 20}};
// -> the call's cost in USD from the API's own usage figures, or null when the model's price is not known.
// batch: the Message Batches API bills half of every token.
export function usageCost(model, usage = {}, {batch = false} = {}) {
  const price = PRICES[model];
  if (!price) return null;
  const n = key => Number(usage[key]) || 0;
  return (batch ? 0.5 : 1) * (n('input_tokens') * price.input + n('cache_creation_input_tokens') * price.input * 1.25
    + n('cache_read_input_tokens') * price.input * 0.1 + n('output_tokens') * price.output) / 1e6;
}

// Only a finding about the app being WRONG can block a journey: a wrong status, a dead control, an error shown. How something looks or reads is medium at most, whatever the model
// said (it rated a vague, duplicated warning "high" in #50 and a clipped brand name "high" in #55 and #56; none blocked anyone).
export const HIGH_KINDS = ['functionality', 'error-shown'];
export const cappedSeverity = (severity, kind) => (severity === 'high' && !HIGH_KINDS.includes(kind) ? 'medium' : severity);

// -> [{view, severity, kind, title, detail, suggestion}], dropping anything off the fixed shape; at most 6 per page.
export function parseFindings(text, view) {
  let data;
  try { data = JSON.parse(String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1)); } catch { return []; }
  return (Array.isArray(data?.findings) ? data.findings : []).filter(item => item && SEVERITIES.includes(item.severity) && KINDS.includes(item.kind)
      && typeof item.title === 'string' && item.title.trim() && typeof item.detail === 'string' && item.detail.trim())
    .slice(0, 6).map(item => ({view, severity: cappedSeverity(item.severity, item.kind), kind: item.kind, title: item.title.trim().slice(0, 80), detail: item.detail.trim().slice(0, 400),
      suggestion: typeof item.suggestion === 'string' ? item.suggestion.trim().slice(0, 300) : ''}));
}

// A stable id for "the same problem again" (the nightly loop opens one PR per problem, not one per night).
export function fingerprint(finding) {
  const words = `${finding.view}|${finding.kind}|${finding.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, ' ').trim();
  let hash = 5381;
  for (const char of words) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return `${finding.view}-${finding.kind}-${hash.toString(36)}`;
}

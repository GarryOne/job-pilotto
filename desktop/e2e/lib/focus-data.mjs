// The Focus suite's data: a dummy job search written to the test workspace through the Notion API (fictional employers only), and an independent
// "numbers match the source" oracle that works out, from the Notion rows alone, what Focus must show. The oracle is deliberately a second
// implementation of the rules written from the product's spec (src/focus.py, src/notion/funnel.py), not a port: if the two disagree, one is wrong.
import {call, createRowIn, queryAll} from './notion.mjs';

const ZONE = 'Europe/Zurich';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------- dates (Focus counts days in Zurich time) ----------
export const zurichDay = date => new Intl.DateTimeFormat('en-CA', {timeZone: ZONE}).format(new Date(date));   // 2026-10-02
const shiftDay = (day, days) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export function zurichAt(day, time) {   // "2026-10-03", "10:00" -> an ISO moment with Zurich's offset on that day (DST-safe)
  const offset = new Intl.DateTimeFormat('en-GB', {timeZone: ZONE, timeZoneName: 'longOffset'}).formatToParts(new Date(`${day}T12:00:00Z`)).find(part => part.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
  return `${day}T${time}:00${offset}`;
}

// ---------- Notion property builders ----------
const text = value => ({rich_text: [{text: {content: value}}]});
const select = name => ({select: {name}});
const props = {
  title: value => ({title: [{text: {content: value}}]}), text, select,
  date: start => ({date: {start}}), number: value => ({number: value}), url: value => ({url: value}),
};

// ---------- the dummy search ----------
// One application per situation a person has to act on. The comment says which Up next row (or number) each one is there to produce.
export function scenario(now = new Date()) {
  const today = zurichDay(now), ago = days => shiftDay(today, -days), tomorrow = shiftDay(today, 1);
  const midday = days => `${ago(days)}T12:00:00Z`;
  const row = (key, fields) => ({key, fields});
  const rows = [
    row('alder', {Job: 'Senior Site Reliability Engineer', Company: 'Alder Labs', Stage: 'Kit ready', 'Fit score': 86, 'Job URL': 'https://jobs.e2e.test/alder/sre', Origin: 'Outbound'}),   // a kit ready to apply
    row('birch', {Job: 'Platform Engineer', Company: 'Birch Systems', Stage: 'Kit ready', 'Fit score': 71, 'Job URL': 'https://jobs.e2e.test/birch/platform', Origin: 'Outbound'}),
    row('cedar', {Job: 'DevOps Engineer', Company: 'Cedar Cloud', Stage: 'Applied', 'Applied on': ago(10), 'Fit score': 78, 'Job URL': 'https://jobs.e2e.test/cedar/devops', Origin: 'Outbound'}),  // waiting 10 days
    row('delta', {Job: 'Site Reliability Engineer', Company: 'Delta Grid', Stage: 'Applied', 'Applied on': today, 'Fit score': 80, 'Job URL': 'https://jobs.e2e.test/delta/sre', Origin: 'Outbound'}),  // applied today
    row('ibis', {Job: 'Infrastructure Engineer', Company: 'Ibis Analytics', Stage: 'Applied', 'Applied on': today, 'Fit score': 74, 'Job URL': 'https://jobs.e2e.test/ibis/infra', Origin: 'Outbound'}),   // applied today
    row('ember', {Job: 'Senior Platform Engineer', Company: 'Ember Data', Stage: 'Interview scheduled', 'Applied on': ago(8), 'Next interview': zurichAt(tomorrow, '10:00'),
      'Fit score': 83, 'Job URL': 'https://jobs.e2e.test/ember/platform', Origin: 'Outbound'}),                                  // a screening tomorrow: Prepare
    row('fjord', {Job: 'Cloud Engineer', Company: 'Fjord Networks', Stage: 'Rejected', 'Applied on': ago(14), 'Feedback status': 'Asked for feedback',
      'Fit score': 69, 'Job URL': 'https://jobs.e2e.test/fjord/cloud', Origin: 'Outbound'}),                                      // an interview held, feedback asked: Add feedback
    row('gale', {Job: 'Site Reliability Engineer', Company: 'Gale Robotics', Stage: 'Rejected', 'Applied on': ago(12), 'Feedback status': 'Skipped',
      'Rejection reason': 'Hard skills', 'Rejection lesson': 'Seniority mismatch. The role wanted a team lead and you had not led one.',
      'Fit score': 65, 'Job URL': 'https://jobs.e2e.test/gale/sre', Origin: 'Outbound'}),                                        // a rejection: the Insight card
    row('huxley', {Job: 'Staff SRE', Via: 'Huxley Partners', Stage: 'Recruiter lead', Salary: 'CHF 160k', Location: 'Zurich', 'Reached via': 'Email',
      'Job URL': 'https://jobs.e2e.test/huxley/staff-sre', Origin: 'Inbound'}),                                                   // a recruiter waiting for an answer: Reply
    row('kestrel', {Job: 'Principal Platform Engineer', Via: 'Kestrel Agency', Stage: 'Interviewing', 'Job URL': 'https://jobs.e2e.test/kestrel/principal', Origin: 'Inbound'}),   // employer unknown: Add details (Skip)
  ];
  const event = (rowKey, kind, at, note = '', extra = {}) => ({rowKey, kind, at, note, source: 'Job Pilotto app', ...extra});
  const events = [
    event('cedar', 'Applied', midday(10)), event('delta', 'Applied', now.toISOString()), event('ibis', 'Applied', now.toISOString()),
    event('ember', 'Applied', midday(8)), event('ember', 'Screening', midday(5)), event('ember', 'Interview scheduled', midday(2)),
    event('fjord', 'Applied', midday(14)), event('fjord', 'Screening', midday(9)), event('fjord', 'Rejected', midday(3)), event('fjord', 'Feedback requested', midday(2)),
    event('gale', 'Applied', midday(12)), event('gale', 'Rejected', midday(1)),
    event('huxley', 'Recruiter lead', new Date(now.getTime() - 5 * 3600e3).toISOString(), 'Are you open to a Staff SRE role in Zurich? CHF 160k, hybrid.', {source: 'Gmail', sourceId: 'e2e-lead-1'}),
    event('kestrel', 'Interviewing', midday(2), 'An agency with a client under NDA. A first call took place.', {source: 'Gmail', sourceId: 'e2e-lead-2'}),
  ];
  return {rows, events};
}

// What Focus must list for that scenario, in order: [kind label on the badge, the primary button]. Written from the product spec
// (who needs an answer first, then what is soonest), not read back from the app.
export const EXPECTED_UP_NEXT = [
  {who: 'Kestrel Agency', badge: 'Add details', buttons: ['Add details', 'Skip']},
  {who: 'Huxley Partners', badge: 'Reply today', buttons: ['Open email', 'Done']},
  {who: 'Ember Data', badge: /^Interview /, buttons: ['Build prep kit']},
  {who: 'Apply to', badge: 'Next step', buttons: ['Browse jobs']},
  {who: 'Fjord Networks', badge: 'Asked for feedback', buttons: ['Add feedback']},
  {who: '1 application waiting', badge: 'When you can', buttons: []},
];


// The Notion properties of a scenario row / event (the one place that knows the column types).
export function rowProperties(fields) {
  const out = {Job: props.title(fields.Job)};
  for (const [name, value] of Object.entries(fields)) {
    if (name === 'Job') continue;
    out[name] = typeof value === 'number' ? props.number(value)
      : name === 'Job URL' ? props.url(value)
      : ['Applied on', 'Next interview'].includes(name) ? props.date(value)
      : ['Stage', 'Origin', 'Feedback status', 'Rejection reason', 'Reached via'].includes(name) ? select(value) : text(value);
  }
  return out;
}
export const eventProperties = (item, fields, rowPageId) => ({
  Event: props.title(`${item.kind} · ${fields.Company || fields.Via}`), Application: {relation: [{id: rowPageId}]}, Kind: select(item.kind),
  At: props.date(item.at), Source: select(item.source), Note: text(item.note || ''), ...(item.sourceId ? {'Source ID': text(item.sourceId)} : {}),
});

// The ids the APP itself works with (window.pilot.state().settings.notionIds): the page can hold several "Search settings" pages or
// databases of the same name after workspaces were rebuilt, and only the app's own are the ones Focus reads and writes.
export const idsFromApp = notionIds => {
  const ids = {tracker: notionIds.NOTION_APPLICATIONS_DB, events: notionIds.NOTION_EVENTS_DB, insights: notionIds.NOTION_INSIGHTS_DB,
    interviews: notionIds.NOTION_INTERVIEWS_DB, profile: notionIds.NOTION_PROFILE_PAGE_ID};
  const missing = Object.entries(ids).filter(([, id]) => !id).map(([name]) => name);
  if (missing.length) throw new Error(`the app has no Notion id for: ${missing.join(', ')}`);
  return ids;
};

// Notion may still list a row it has already trashed: trashing it again is not an error.
const archive = (token, id) => call(token, 'PATCH', `pages/${id}`, {archived: true}).catch(error => { if (!/archived/i.test(error.message)) throw error; });

async function emptyById(token, databaseId) {   // every row to the trash, then check (Notion shows it a moment later)
  let rows = await queryAll(token, databaseId);
  const count = rows.length;
  for (let round = 0; rows.length && round < 6; round++) {
    for (const row of rows) { await archive(token, row.id); await sleep(350); }
    await sleep(2000);
    rows = await queryAll(token, databaseId);
  }
  if (rows.length) throw new Error(`${rows.length} row(s) of database ${databaseId} would not go to the trash`);
  return count;
}
// ⚙️ Search settings is a child of the Profile page; the app creates it the first time the target is changed, so it may not exist yet.
const searchPageOf = async (token, profileId) => {
  const children = (await call(token, 'GET', `blocks/${profileId}/children?page_size=100`)).results;
  return children.find(block => block.type === 'child_page' && /search settings/i.test(block.child_page.title))?.id || null;
};
const targetBullet = async (token, pageId) => {   // the bullet under "Daily applications target"
  const blocks = (await call(token, 'GET', `blocks/${pageId}/children?page_size=100`)).results;
  const at = blocks.findIndex(block => block.type === 'heading_2' && /daily applications target/i.test(block.heading_2.rich_text.map(part => part.plain_text).join('')));
  const bullet = blocks[at + 1];
  if (at < 0 || bullet?.type !== 'bulleted_list_item') throw new Error(`"Daily applications target" has no bullet under it in Search settings (page ${pageId}, ${blocks.length} blocks: ${blocks.slice(0, 6).map(block => block.type).join(', ')})`);
  return bullet;
};
export async function readTargetLine(token, pageId) {   // the page the app says it wrote (settings.notionIds.NOTION_SEARCH_SETTINGS_PAGE)
  return Number((await targetBullet(token, pageId)).bulleted_list_item.rich_text.map(part => part.plain_text).join(''));
}
async function setTargetLine(token, profileId, target) {   // nothing to reset while the page does not exist: the app then reads the default, 5
  const pageId = await searchPageOf(token, profileId);
  if (pageId) await call(token, 'PATCH', `blocks/${(await targetBullet(token, pageId)).id}`, {bulleted_list_item: {rich_text: [{text: {content: String(target)}}]}});
}

// Remove this suite's data (rows to the trash; the workspace stays) and, with `data`, write the scenario. Returns the database ids.
export async function resetFocusData(token, ids, {data = null, target = 5} = {}) {
  for (const id of [ids.tracker, ids.events, ids.insights, ids.interviews]) await emptyById(token, id);
  await setTargetLine(token, ids.profile, target);
  if (!data) return ids;
  const pages = {};
  for (const {key, fields} of data.rows) { pages[key] = await createRowIn(token, ids.tracker, rowProperties(fields)); await sleep(350); }
  for (const item of data.events) {
    await createRowIn(token, ids.events, eventProperties(item, data.rows.find(r => r.key === item.rowKey).fields, pages[item.rowKey].id));
    await sleep(350);
  }
  // On a Mac without this suite's own Notion page the suite shares the wizard's page, and another session's app may write into it meanwhile:
  // an event that belongs to none of this scenario's applications is not part of the data under test. Remove it, and say so.
  const mine = new Set(Object.values(pages).map(page => page.id));
  const strayRows = (await queryAll(token, ids.tracker)).filter(row => !mine.has(row.id));
  for (const row of strayRows) { await archive(token, row.id); await sleep(350); }
  const foreign = (await queryAll(token, ids.events)).filter(item => !(item.properties.Application?.relation || []).some(link => mine.has(link.id)));
  for (const item of foreign) { await archive(token, item.id); await sleep(350); }
  if (foreign.length || strayRows.length) console.log(`  removed ${strayRows.length} application(s) and ${foreign.length} event(s) another session wrote into this page meanwhile (a shared fallback page: set E2E_NOTION_TOKEN_FOCUS for a page of its own)`);
  return pages;
}

// ---------- the oracle: what the numbers on Focus must be, from the Notion rows alone ----------
const read = (page, name) => {
  const p = page.properties?.[name];
  if (!p) return '';
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'date') return p.date?.start || '';
  if (p.type === 'number') return p.number;
  if (p.type === 'url') return p.url || '';
  if (p.type === 'relation') return p.relation.map(r => r.id.replace(/-/g, ''));
  return (p.rich_text || p.title || []).map(part => part.plain_text).join('');
};
const OUTCOME = new Set(['Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn', 'No response']);
const PREPARED = new Set(['Kit ready', 'Applying']);
const STEP_MARKS = [   // the funnel as the product defines it: the stages/events that mean "this application reached the step"
  {name: 'Prepared', marks: null}, {name: 'Applied', marks: OUTCOME},
  {name: 'Human reply', marks: new Set(['Reply received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer'])},
  {name: 'Screening', marks: new Set(['Screening', 'Interview scheduled', 'Interviewing', 'Offer'])},
  {name: 'Interviews', marks: new Set(['Interviewing', 'Offer'])}, {name: 'Offers', marks: new Set(['Offer'])},
];

export function expectedNumbers(rows, events, {now = new Date(), target = 5} = {}) {
  const today = zurichDay(now);
  const kindsByApp = new Map();
  for (const item of events) for (const id of read(item, 'Application')) kindsByApp.set(id, [...(kindsByApp.get(id) || []), read(item, 'Kind')]);
  // applications per day: an application counts once on each day it has an Applied on date or an Applied event
  const daysByApp = new Map();
  const mark = (id, day) => daysByApp.set(id, new Set([...(daysByApp.get(id) || []), day]));
  for (const row of rows) if (read(row, 'Applied on')) mark(row.id.replace(/-/g, ''), read(row, 'Applied on').slice(0, 10));
  for (const item of events) if (read(item, 'Kind') === 'Applied') for (const id of read(item, 'Application')) mark(id, zurichDay(read(item, 'At')));
  const perDay = {};
  for (const days of daysByApp.values()) for (const day of days) perDay[day] = (perDay[day] || 0) + 1;
  const last14 = Array.from({length: 14}, (_, i) => shiftDay(today, i - 13));
  const total = last14.reduce((sum, day) => sum + (perDay[day] || 0), 0);
  const onTarget = last14.filter(day => (perDay[day] || 0) >= target).length;
  const applied = perDay[today] || 0;

  const outbound = [], inbound = [];
  for (const row of rows) {
    const origin = read(row, 'Origin');
    if (!origin) throw new Error(`the oracle needs an explicit Origin on every row (${read(row, 'Job')} has none)`);
    const stage = read(row, 'Stage');
    const app = {seen: new Set([...(kindsByApp.get(row.id.replace(/-/g, '')) || []), stage])};
    if (origin === 'Inbound') inbound.push(app);
    else if (OUTCOME.has(stage) || PREPARED.has(stage)) outbound.push(app);
  }
  const steps = (apps, list) => list.map(({name, marks}) => ({name, reached: apps.filter(app => !marks || [...app.seen].some(kind => marks.has(kind))).length}));
  const share = (list, first) => list.map(step => ({...step, share: Math.round(100 * step.reached / Math.max(first, 1))}));
  const out = steps(outbound, STEP_MARKS).slice(0, 5), inb = steps(inbound, [{name: 'Contacted you', marks: null}, ...STEP_MARKS.slice(3)]);
  const kits = rows.filter(row => read(row, 'Stage') === 'Kit ready').length;
  const pct = Math.min(100, Math.round(100 * applied / Math.max(target, 1)));
  return {
    applied, target, pct, kits,
    ofText: `/ ${target} applications today`, pctText: `${pct}%`,
    chartSum: `${total} applied · ${onTarget} day${onTarget === 1 ? '' : 's'} on target`,
    funnel: share(out, out[0].reached), inbound: inbound.length ? share(inb, inb[0].reached) : [],
  };
}

// What the page shows vs what the oracle says: a list of plain-English differences ([] when every number matches).
export function compareNumbers(shown, expected) {
  const diffs = [];
  const same = (label, got, want) => { if (String(got) !== String(want)) diffs.push(`${label}: Focus shows "${got}", Notion says "${want}"`); };
  same('applications today', shown.count, expected.applied);
  same('the target line', shown.of, expected.ofText);
  same('the progress percentage', shown.pct, expected.pctText);
  same('the progress bar width', shown.bar, `${expected.pct}%`);
  same('the 14-day chart summary', shown.chartSum, expected.chartSum);
  same('the number of funnel steps', shown.funnel.length, expected.funnel.length);
  expected.funnel.forEach((step, i) => {
    const got = shown.funnel[i] || {};
    same(`funnel step ${i + 1} name`, got.name, step.name);
    same(`funnel "${step.name}" count`, got.count, step.reached);
    same(`funnel "${step.name}" share`, got.share, `${step.share}% reached`);
  });
  same('the number of inbound steps', shown.inbound.length, expected.inbound.length);
  expected.inbound.forEach((step, i) => {
    const got = shown.inbound[i] || {};
    same(`inbound "${step.name}" count`, got.count, step.reached);
    same(`inbound "${step.name}" share`, got.share, `${step.share}% reached`);
  });
  return diffs;
}

export {queryAll};

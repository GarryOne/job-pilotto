// Your contact details (name, email, phone, city, links), used to fill forms. With Notion connected they are
// the "📇 Contact details" section of your Notion Profile page, the source of truth ("- Email: you@x.com");
// edit them there or in Settings → Your details. Without Notion they wait in settings.json (contact).
import * as notion from './notion.js';

export const HEADING = '📇 Contact details';
export const LABELS = {first_name: 'First name', last_name: 'Last name', full_name: 'Full name', email: 'Email', phone: 'Phone',
  location: 'Location', linkedin: 'LinkedIn', github: 'GitHub', website: 'Website'};
const KEY_BY_LABEL = Object.fromEntries(Object.entries(LABELS).map(([key, label]) => [label.toLowerCase(), key]));
export const markdown = contact => `## ${HEADING}\n` + Object.entries(LABELS)
  .filter(([key]) => contact[key]).map(([key, label]) => `- ${label}: ${contact[key]}`).join('\n');

const target = storage => {
  const token = storage.secret('NOTION_TOKEN'), page = storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID;
  return token && page ? {token, page} : null;
};
// The section: its heading block and the "Label: value" lines under it (until the next heading).
async function section(t, fetcher) {
  const blocks = await notion.textBlocks(t.token, t.page, fetcher);
  const start = blocks.findIndex(b => b.type.startsWith('heading') && b.text.includes('Contact details'));
  if (start < 0) return {heading: null, lines: []};
  const end = blocks.findIndex((b, i) => i > start && b.type.startsWith('heading'));
  return {heading: blocks[start], lines: blocks.slice(start + 1, end < 0 ? undefined : end)};
}

export async function read(storage, fetcher) {
  const t = target(storage);
  if (!t) return storage.settings().contact || {};
  const {lines} = await section(t, fetcher);
  const contact = {};
  for (const line of lines) {
    const [label, ...rest] = line.text.split(':');
    const key = KEY_BY_LABEL[label.trim().toLowerCase()];
    if (key && rest.join(':').trim()) contact[key] = rest.join(':').trim();
  }
  return contact;
}

export async function save(storage, contact, fetcher) {
  const clean = Object.fromEntries(Object.entries(contact || {}).filter(([key, value]) => LABELS[key] && value));
  const t = target(storage);
  if (!t) { storage.saveSettings({contact: clean}); return clean; }
  let {heading, lines} = await section(t, fetcher);
  for (const line of lines) {
    if (KEY_BY_LABEL[line.text.split(':')[0].trim().toLowerCase()]) await notion.deleteBlock(t.token, line.id, fetcher);
  }
  const headingId = heading?.id || await notion.appendHeading(t.token, t.page, HEADING, fetcher);
  await notion.insertBulletsAfter(t.token, t.page, headingId,
    Object.entries(LABELS).filter(([key]) => clean[key]).map(([key, label]) => `${label}: ${clean[key]}`), fetcher);
  return clean;
}

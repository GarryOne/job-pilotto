// Your contact details (name, email, phone, city, links), used to fill forms. With Notion connected they are
// the "📇 Contact details" section of your Notion Profile page, the source of truth ("- Email: you@x.com");
// edit them there or in Settings → Your details. Notion is required.
import * as notion from './notion.js';

export const HEADING = '📇 Contact details';
export const LABELS = {first_name: 'First name', last_name: 'Last name', full_name: 'Full name', email: 'Email', phone: 'Phone',
  location: 'Location', salutation: 'Salutation', street: 'Street', postal_code: 'Postal code', place_of_origin: 'Place of origin', birth_date: 'Date of birth', linkedin: 'LinkedIn', github: 'GitHub', website: 'Website'};
const KEY_BY_LABEL = Object.fromEntries(Object.entries(LABELS).map(([key, label]) => [label.toLowerCase(), key]));
export const markdown = contact => `## ${HEADING}\n` + Object.entries(LABELS)
  .filter(([key]) => contact[key]).map(([key, label]) => `- ${label}: ${contact[key]}`).join('\n');

const target = storage => {
  const token = storage.secret('NOTION_TOKEN'), page = storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID;
  if (!token || !page) throw new Error('Connect Notion first: your contact details live in your Profile page.');
  return {token, page};
};
// The section: its heading block and the "Label: value" lines under it (until the next heading).
async function section(t, fetcher) {
  const blocks = await notion.textBlocks(t.token, t.page, fetcher);
  const start = blocks.findIndex(b => b.type.startsWith('heading') && b.text.includes('Contact details'));
  if (start < 0) return {heading: null, lines: []};
  const end = blocks.findIndex((b, i) => i > start && b.type.startsWith('heading'));
  return {heading: blocks[start], lines: blocks.slice(start + 1, end < 0 ? undefined : end)};
}

// Lines under the headings that match `title`, until the next heading.
const under = (blocks, title) => blocks.filter((b, i) => !b.type.startsWith('heading') &&
  title.test(blocks.slice(0, i).reverse().find(h => h.type.startsWith('heading'))?.text.trim() || ''));

export async function read(storage, fetcher) {
  const t = target(storage);
  const {heading, lines} = await section(t, fetcher);
  // Profiles written before the app kept them as "Contact" (Name: …) and "Links" (LinkedIn: …): read those too.
  const blocks = heading ? [] : await notion.textBlocks(t.token, t.page, fetcher);
  const contact = {};
  for (const line of heading ? lines : under(blocks, /^(📇\s*)?(contact|links)$/i)) {
    const [label, ...rest] = line.text.split(':');
    const value = rest.join(':').trim(), name = label.trim().toLowerCase();
    const key = KEY_BY_LABEL[name] || (name === 'name' ? 'full_name' : null);
    if (key && value && !contact[key]) contact[key] = value;
  }
  if (contact.full_name && !contact.first_name) {
    const [first, ...last] = contact.full_name.split(/\s+/);
    Object.assign(contact, {first_name: first, ...(last.length ? {last_name: last.join(' ')} : {})});
  }
  return contact;
}

export async function save(storage, contact, fetcher) {
  const clean = Object.fromEntries(Object.entries(contact || {}).filter(([key, value]) => LABELS[key] && value));
  const t = target(storage);
  let {heading, lines} = await section(t, fetcher);
  for (const line of lines) {
    if (KEY_BY_LABEL[line.text.split(':')[0].trim().toLowerCase()]) await notion.deleteBlock(t.token, line.id, fetcher);
  }
  const headingId = heading?.id || await notion.appendHeading(t.token, t.page, HEADING, fetcher);
  await notion.insertBulletsAfter(t.token, t.page, headingId,
    Object.entries(LABELS).filter(([key]) => clean[key]).map(([key, label]) => `${label}: ${clean[key]}`), fetcher);
  return clean;
}

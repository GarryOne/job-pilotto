// Your contact details (name, email, phone, city, links), used to fill forms: the "📇 Contact details" section of your
// Profile in the active store (lib/store: Notion's Profile page, or profile.md on this Mac), the source of truth
// ("- Email: you@x.com"); edit them there or in Settings → Your details.
import {openStore} from './store/index.js';

export const HEADING = '📇 Contact details';
export const LABELS = {first_name: 'First name', last_name: 'Last name', full_name: 'Full name', email: 'Email', phone: 'Phone',
  location: 'Location', salutation: 'Salutation', street: 'Street', postal_code: 'Postal code', place_of_origin: 'Place of origin', birth_date: 'Date of birth', linkedin: 'LinkedIn', github: 'GitHub', website: 'Website'};
const KEY_BY_LABEL = Object.fromEntries(Object.entries(LABELS).map(([key, label]) => [label.toLowerCase(), key]));
export const markdown = contact => `## ${HEADING}\n` + Object.entries(LABELS)
  .filter(([key]) => contact[key]).map(([key, label]) => `- ${label}: ${contact[key]}`).join('\n');

const profile = (storage, fetcher) => openStore(storage, {fetcher}).page('profile');
// The section: its heading block and the "Label: value" lines under it (until the next heading).
async function section(page) {
  const blocks = await page.blocks();
  const start = blocks.findIndex(b => b.type.startsWith('heading') && b.text.includes('Contact details'));
  if (start < 0) return {heading: null, lines: []};
  const end = blocks.findIndex((b, i) => i > start && b.type.startsWith('heading'));
  return {heading: blocks[start], lines: blocks.slice(start + 1, end < 0 ? undefined : end)};
}

// Lines under the headings that match `title`, until the next heading.
const under = (blocks, title) => blocks.filter((b, i) => !b.type.startsWith('heading') &&
  title.test(blocks.slice(0, i).reverse().find(h => h.type.startsWith('heading'))?.text.trim() || ''));

export async function read(storage, fetcher) {
  const page = profile(storage, fetcher);
  const {heading, lines} = await section(page);
  // Profiles written before the app kept them as "Contact" (Name: …) and "Links" (LinkedIn: …): read those too.
  const blocks = heading ? [] : await page.blocks();
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
  const page = profile(storage, fetcher);
  const {heading, lines} = await section(page);
  for (const line of [...lines].reverse()) {
    if (KEY_BY_LABEL[line.text.split(':')[0].trim().toLowerCase()]) await page.remove(line);
  }
  const headingId = heading?.id || await page.appendHeading(HEADING);
  const fresh = Object.entries(LABELS).filter(([key]) => clean[key]).map(([key, label]) => `${label}: ${clean[key]}`);
  if (fresh.length) await page.insertAfter(headingId, fresh);
  return clean;
}

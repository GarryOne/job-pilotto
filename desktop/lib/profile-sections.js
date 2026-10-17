// Your details' sections beyond Contact (owner, 17 Oct 2026: "Your details = facts, in 3 sections"): Work eligibility, Availability & compensation and
// Languages. Each is a heading on the Profile page with "Label: value" lines under it, the shape of 📇 Contact details (lib/contact.js), on every store
// (lib/store): the Profile stays one page, so a value moved here never leaves it. Forms and Strategy read these facts from here: one source per value.
// Guarded by test/profile-sections.test.js.
import {openStore} from './store/index.js';

export const SECTIONS = {
  eligibility: '🛂 Work eligibility',
  availability: '💶 Availability & compensation',
  languages: '🗣️ Languages',
};

const profile = (storage, fetcher) => openStore(storage, {fetcher}).page('profile');
const isHeading = block => block.type.startsWith('heading');
// Our headings are written by the app: matched whole, the leading emoji aside (a person may delete or change it).
const bare = text => String(text || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
const keyOfHeading = text => Object.keys(SECTIONS).find(key => bare(SECTIONS[key]) === bare(text)) || '';

// The page's blocks grouped: {[key]: {heading, lines}} for each section found.
function grouped(blocks) {
  const out = {};
  let current = null;
  for (const block of blocks) {
    if (isHeading(block)) {
      const key = keyOfHeading(block.text);
      current = key && !out[key] ? (out[key] = {heading: block, lines: []}) : null;
    } else if (current) current.lines.push(block);
  }
  return out;
}

const itemOf = text => {
  const at = String(text || '').indexOf(':');
  return at < 0 ? {label: String(text || '').trim(), value: ''} : {label: text.slice(0, at).trim(), value: text.slice(at + 1).trim()};
};

// -> {eligibility: [{label, value}], availability: [...], languages: [...]} (an empty section or a missing one: []).
export async function read(storage, fetcher) {
  const found = grouped(await profile(storage, fetcher).blocks());
  return Object.fromEntries(Object.keys(SECTIONS).map(key => [key, (found[key]?.lines || []).map(line => itemOf(line.text)).filter(item => item.label)]));
}

// The section's lines replaced by these items ({label, value}); its heading is added at the end of the page the first time.
export async function save(storage, key, items, fetcher) {
  if (!SECTIONS[key]) throw new Error(`"${key}" is not a Your details section`);
  const page = profile(storage, fetcher);
  const found = grouped(await page.blocks())[key];
  for (const line of [...(found?.lines || [])].reverse()) await page.remove(line);   // last first: this Mac's ids are line numbers
  const lines = (items || []).filter(item => item?.label && String(item.value ?? '').trim()).map(item => `${String(item.label).trim()}: ${String(item.value).trim()}`);
  if (!lines.length) return [];
  const heading = found?.heading.id || await page.appendHeading(SECTIONS[key]);
  await page.insertAfter(heading, lines);
  return lines;
}

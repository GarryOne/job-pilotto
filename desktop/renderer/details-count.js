// How many of Your details' fields differ from what was last read or saved (pages/details-drafts.js, the Profile page's one save bar; UI redesign D2,
// 18 Oct 2026). Pure, so test/details-drafts.test.js runs it without a window.
// The boxes as typed now ({first_name: 'Alex', ...}); full_name is made from first + last on save.
export const contactNow = (doc = document) => Object.fromEntries([...doc.querySelectorAll('[data-contact]')].filter(input => input.dataset.contact !== 'full_name')
  .map(input => [input.dataset.contact, String(input.value || '').trim()]));
export const countContact = (saved, now) => Object.keys(now).filter(key => now[key] !== String(saved[key] || '').trim()).length;
// Lines per section: a changed line is one change (one gone + one new), an added or removed line one.
export function countFacts(saved, now) {
  let changes = 0;
  for (const key of new Set([...Object.keys(saved), ...Object.keys(now)])) {
    const before = (saved[key] || []).map(line => JSON.stringify(line)), after = (now[key] || []).map(line => JSON.stringify(line));
    changes += Math.max(after.filter(line => !before.includes(line)).length, before.filter(line => !after.includes(line)).length);
  }
  return changes;
}

// The Profile page's headings that Settings → Profile → Your details edits (lib/contact.js HEADING, lib/profile-sections.js SECTIONS): other screens
// that list the Profile's lines leave these sections out, so each value has one editor. Kept equal to the main process's by test/job-preferences.test.js.
export const DETAILS_HEADINGS = ['📇 Contact details', '🛂 Work eligibility', '💶 Availability & compensation', '🗣️ Languages'];
const bare = text => String(text || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
export const isDetailsHeading = text => DETAILS_HEADINGS.some(heading => bare(heading) === bare(text));

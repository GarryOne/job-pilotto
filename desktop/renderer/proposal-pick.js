// The proposed answer for a field the form still has empty (no DOM: the session page's row asks this, a test feeds it every source).
// In order: what the fill proposed for that field (a value the form did not take); else, when the field asks for a contact detail
// (the extension knew it, or Claude read the label: lib/contact-keys.js), your saved detail, then the CV's proposal; else an empty
// box that keeps what you type for every form. null: nothing to propose (the row stays "Open in form").
const NAMES = {phone: 'phone', street: 'street', postal_code: 'postal code', location: 'town', birth_date: 'date of birth',
  place_of_origin: 'place of origin', salutation: 'salutation', first_name: 'first name', last_name: 'last name', email: 'email'};
export function pickProposal({proposals = [], label, key = '', contact = {}, cv = []} = {}) {
  const found = proposals.find(proposal => proposal.label === label);
  if (found?.value) return {value: found.value, key: found.key || key || '', from: 'Proposed by the fill: the form did not take it'};
  const wants = found?.key || key;
  if (!wants) return null;
  if (String(contact?.[wants] || '').trim()) return {value: contact[wants], key: wants, from: 'From your details'};
  const mine = cv.find(proposal => proposal.field === wants);
  if (mine) return {value: mine.value, key: wants, from: mine.sure ? 'From your CV' : 'From your CV: check it'};
  return {value: '', key: wants, from: `Your ${NAMES[wants] || 'detail'}: type it once, every form gets it`};
}

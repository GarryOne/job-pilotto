// The proposed answer for a field the form still has empty (no DOM: the session page's row asks this, a test feeds it every source).
// In order: what the fill proposed for that field (a value the form did not take); else, when the field asks for a contact detail
// (the extension knew it, or Claude read the label: lib/contact-keys.js), your saved detail, then the CV's proposal; else an empty
// box that keeps what you type for every form. null: nothing to propose (the row stays "Open in form").
const NAMES = {phone: 'phone', street: 'street', postal_code: 'postal code', location: 'town', birth_date: 'date of birth',
  place_of_origin: 'place of origin', salutation: 'salutation', first_name: 'first name', last_name: 'last name', email: 'email'};
export function pickProposal(ask = {}) {
  const proposal = proposalOf(ask), options = (ask.proposals || []).find(item => item.label === ask.label)?.options || [];
  return proposal && options.length ? {...proposal, options} : proposal;
}
// A menu's row proposes one of the form's own choices (owner, 8 Oct 2026: "Monsieur" was typed into a Madam/Sir menu): the same text is
// taken as it is; `choice` is what lib/option-pick.js found means the same (undefined: not asked yet; '': none does).
export function onChoices(proposal, choice) {
  if (!proposal?.options?.length || !proposal.value) return proposal;
  const same = proposal.options.find(option => option.trim().toLowerCase() === proposal.value.trim().toLowerCase());
  if (same) return {...proposal, value: same};
  if (choice === undefined) return {...proposal, value: '', waiting: true, original: proposal.value};
  return choice ? {...proposal, value: choice, original: proposal.value, from: `${proposal.from} ("${proposal.value}" on this form)`}
    : {...proposal, value: '', original: proposal.value, from: `None of this form's choices means "${proposal.value}": pick one`};
}
function proposalOf({proposals = [], label, key = '', contact = {}, cv = []} = {}) {
  const found = proposals.find(proposal => proposal.label === label);
  if (found?.value) return {value: found.value, key: found.key || key || '', from: 'Proposed by the fill: the form did not take it'};
  const wants = found?.key || key;
  if (!wants) return null;
  if (String(contact?.[wants] || '').trim()) return {value: contact[wants], key: wants, from: 'From your details'};
  const mine = cv.find(proposal => proposal.field === wants);
  if (mine) return {value: mine.value, key: wants, from: mine.sure ? 'From your CV' : 'From your CV: check it'};
  return {value: '', key: wants, from: `Your ${NAMES[wants] || 'detail'}: type it once, every form gets it`};
}

// The kind of every Your details contact field (owner, 17 Oct 2026, "A kind for every field": base facts fixed): a salutation is picked, a date of birth is a date saved in
// the person's words, links are links; the rest are text with their own keyboard (email, phone). One entry per key of lib/contact.js LABELS: a field added there without a kind here
// fails test/contact-kinds.test.js, and the mount (renderer/contact-controls.js) draws each from this table, so a new field needs no new UI code.
export const SALUTATIONS = ['Mr', 'Ms', 'Mrs', 'Mx', 'Dr', 'Prof'];
export const CONTACT_KINDS = {
  first_name: {kind: 'text'}, last_name: {kind: 'text'}, full_name: {kind: 'text'}, email: {kind: 'text'}, phone: {kind: 'text'}, location: {kind: 'text'},
  street: {kind: 'text'}, postal_code: {kind: 'text'}, place_of_origin: {kind: 'text'},
  salutation: {kind: 'single', options: SALUTATIONS}, birth_date: {kind: 'date'},
  linkedin: {kind: 'link'}, github: {kind: 'link'}, website: {kind: 'link'},
};

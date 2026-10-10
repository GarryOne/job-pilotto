// Scrubs what goes into a ladder fixture (a public repo): an email that is not example.* becomes contact@example.com, a phone-shaped number becomes "(phone)", a URL loses its query string and fragment.
// Used by ladder-capture.mjs and ladder-candidates.mjs. Guard: test/ladder-candidates.test.js, test/ladder-fixtures.test.js (the same rules, checked on the stored fixtures).
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /\+?\d[\d\s().\/-]{6,}\d/g;
const deep = (value, one) => (typeof value === 'string' ? one(value) : Array.isArray(value) ? value.map(item => deep(item, one)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deep(item, one)])) : value);

export const noEmail = value => deep(value, text => text.replace(EMAIL, email => (/@example\.(com|org|net|ch)$/i.test(email) ? email : 'contact@example.com')));
export const noPhone = value => deep(value, text => text.replace(PHONE, number => (number.replace(/\D/g, '').length >= 8 ? '(phone)' : number)));
export const stripQuery = url => String(url || '').split(/[?#]/)[0];

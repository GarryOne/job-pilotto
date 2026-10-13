// A page the AI judged "other" (no job page: an error, a list, a consent wall, a page that needs nothing from the candidate) stays "other" at ANY confidence: its form fields never turn it
// into the application (13 Oct 2026, the owner's own Chrome: a pull request was filled; owner and cc: "fields alone never decide", a weak answer is asked again, never overridden by structure).
// Meaning stays the AI's (CLAUDE.md "Judgments about a page are the AI's"); structure only finds controls. Guard: desktop/test/page-kind-final.test.js.
// kind: the page-kind answer ({kind, confidence, signal}), or null (no answer: the structure rule decides, as before).
export const noJobPage = kind => kind?.kind === 'other';

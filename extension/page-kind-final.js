// A page the AI judged "other" and was sure of is final: the page's form fields never turn it into the application (13 Oct 2026, the owner's own Chrome: a pull request was filled).
// Meaning stays the AI's (CLAUDE.md "Judgments about a page are the AI's"); structure only finds controls. Guard: desktop/test/page-kind-final.test.js.
export const FINAL_FROM = 0.8;   // desktop/lib/ladder/rung2-sketch.js KEEP_FROM (sure enough to keep); the test keeps the two equal
// kind: the page-kind answer ({kind, signal, confidence}), or null. An unsure answer climbs the ladder before it gets here (ladder/climb.js): it is never final.
export const sureOther = kind => kind?.kind === 'other' && kind.signal === 'confident' && Number(kind.confidence) >= FINAL_FROM;

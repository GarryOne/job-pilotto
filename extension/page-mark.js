// What the page IS, said on the page for the panel (owner, 15 Oct 2026: the panel said "Ready to submit" on a posting with only an Apply button). The AI's kind decides in fill-flow.js;
// the panel (review.js) only reads this mark: 'posting' (no form yet: "Press Apply to open the form"), 'opening' (Apply was pressed: "Opening the form…"), 'form' or 'account' (judged: the panel counts), no mark yet = still being read: Reading this page, never Ready (owner, 15 Oct 2026)).
// The state comes from the flow's own role (the AI's kind decided it): only a page with no form is marked.
export const markPage = (tabId, role, pressed = false) => chrome.scripting.executeScript({target: {tabId}, func: value => {
  if (value) document.documentElement.setAttribute('data-jobpilotto-page', value); else document.documentElement.removeAttribute('data-jobpilotto-page');
}, args: [role === 'no-form' ? (pressed ? 'opening' : 'posting') : role === 'form' || role === 'account' ? role : '']}).catch(() => {});   // form / account: judged, the panel may count

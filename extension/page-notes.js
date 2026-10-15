// Notes to the person go INTO the panel's note line while the panel is on the page; the floating box is only for a page without a panel (owner, 15 Oct 2026:
// "why do we see both panels, top-right and bottom-left?"). Every note of background.js (note, ineligibleNote) asks here first. Guard: desktop/test/extension-panel-notes.test.js.
// -> true when the panel took it (review.js answers {shown: true} only when its host is on the page).
export async function tellPanel(tabId, text, anyway = false) {
  const reply = await chrome.tabs.sendMessage(tabId, {type: 'panelNote', text: String(text || '').slice(0, 400), anyway: !!anyway}).catch(() => null);
  return !!reply?.shown;
}

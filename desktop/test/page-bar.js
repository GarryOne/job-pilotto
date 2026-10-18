// Test helper: the page save bar a card's drafts sit on (save-bar.js pageSaveBar): the shared bar an outline tab made in its card when the page had
// none (pages/outline-tab.js), else its page's one bar: Strategy's for Job preferences (pages/strategy-cards.js), Profile's for the rest
// (pages/profile-save-bar.js). Load it after tiny-dom's install().
export async function pageBar(node) {
  const near = node.parentNode?.querySelector('.page-save-bar');
  if (near) return near;
  if (node.id === 'preferences-body') {
    const {strategyBarNow} = await import('../renderer/pages/strategy-cards.js');
    if (strategyBarNow()) return strategyBarNow().node;
  }
  const {profileBar} = await import('../renderer/pages/profile-save-bar.js');
  return profileBar().node;
}
// Save all changes, as by hand (awaits the save).
export const pressSave = async node => (await pageBar(node)).querySelector('button.primary').listeners.click[0]();

// What the strategy writers (lib/strategy.js: addRoles, addPlaces, editLists, retune, setDailyTarget...) are given to write the Notion settings
// page, shared by main.js and the search-tuning handlers: the pipeline runner, and the page writer that tells the window how far it got
// (renderer/save-progress.js), as the page is rewritten a block at a time (7 Oct 2026: Save sat on "Saving…" 71 s and nothing said why).
import * as notion from './notion.js';   // Notion-only: the ⚙️ Search settings page writer, called only through publishSearchSettings when Notion is the store
import * as pipeline from './pipeline.js';

export function settingsDepsFor(toWindow) {
  const progress = (stage, extra = {}) => toWindow('settingsProgress', {stage, ...extra});
  return () => ({
    run: (store, args, ...rest) => {
      if (args[0] === 'src.notion.search_settings' && args[1] === 'sync') progress('read');
      return pipeline.run(store, args, ...rest);
    },
    ensurePage: notion.ensurePage,
    writePage: (token, page, markdown) => notion.writePage(token, page, markdown, undefined, (done, total) => progress('write', {done, total})),
  });
}

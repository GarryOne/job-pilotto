// Connecting to the user's Notion with a token (pasted, or from "Connect with Notion"): find their Jobadabra
// workspace, or build it from config/notion_schema.json, then add anything missing (schema.repair).
// templateRoot: the page Notion copied the Jobadabra template into during "Connect with Notion" (the token's
// duplicated_template_id). Notion copies it over a minute or so: the app waits for that copy only (never an
// older one elsewhere), and builds in that page when it stays empty. Without it: the user picked their own page.
import * as notion from './notion.js';
import * as schema from './schema.js';

// -> {ok, ids, missing, problems, built?, repaired?}
export async function connectWorkspace(token, {templateRoot = null, fresh = false, onProgress = () => {}, fetcher,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), repair = schema.repair, every = 5000} = {}) {
  const root = templateRoot ? String(templateRoot).replace(/-/g, '') : null;
  const send = progress => onProgress({...progress, ...(root ? {template: true} : {})});
  // fresh (this profile has no workspace of its own, e.g. after a reset; owner, 16 Oct 2026, "Always start new"): an existing Jobadabra page is
  // never discovered or reused; the app builds a new workspace beside it and leaves the old one as it is. Only the template's own copy (root) is read.
  const startNew = fresh && !root;
  if (startNew) await notion.call(token, 'GET', 'users/me', null, fetcher);   // is the token valid at all?
  let result = root ? await notion.connectWaiting(token, {fetcher, sleep, onProgress: send, root, tries: 12})
    : startNew ? {ok: false, ids: {}, missing: ['Job Pilotto'], problems: []}
    : await notion.connect(token, fetcher);
  // Nothing of ours yet: the one page shared with the app (or the template's copy) is where the workspace is built.
  if (!result.ok && !Object.keys(result.ids || {}).length) {
    let page = root;
    for (let attempt = 0; !page && attempt < 12; attempt++) {
      page = await notion.sharedRoot(token, fetcher, {fresh: startNew});  // Notion can take a few seconds to share it with the connection
      if (!page) { send({waitingPage: true}); await sleep(every); }
    }
    if (page) {
      send({building: true});
      const built = await repair(token, {}, schema.load(), fetcher, page);
      result = {ok: built.created.length > 0 && !!built.ids.NOTION_PROFILE_PAGE_ID, ids: built.ids, missing: [], problems: [], built: built.created};
    }
  }
  // Some parts found (a copied template still being shared): wait for the rest.
  else if (!result.ok && !root) result = await notion.connectWaiting(token, {fetcher, sleep, onProgress: send});
  // Missing columns or databases (an older template, or a deleted one): add them from the schema, check again.
  if (!result.ok && (result.ids?.NOTION_PROFILE_PAGE_ID || (root && Object.keys(result.ids || {}).length))) {
    const fixed = await repair(token, result.ids, schema.load(), fetcher, root);
    if (fixed.created.length || fixed.columns.length || fixed.manual?.length) result = {...await notion.connect(token, fetcher, {root}), repaired: fixed};
  }
  return result;
}

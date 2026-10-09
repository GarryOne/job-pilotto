// Where the app under test keeps the person's data in a run (spec docs/superpowers/specs/2026-10-09-store-adapters.md, P7: every suite runs with
// NO Notion token). 'sqlite': this Mac's store (settings.store = 'sqlite'), no Notion at all. 'standin': the Notion store on the in-memory
// Notion (lib/notion-fake.mjs), fresh per run. 'notion': the real test workspace with a token, only for a suite that pins it (`export const
// store = 'notion'`, the release gate's notion-real). Guarded by test/store.test.mjs.
import {isCi} from './engine.mjs';

export const STORES = ['sqlite', 'standin', 'notion'];

// E2E_STORE pins one; E2E_NOTION_STANDIN=1 is the older name for 'standin'. CI alternates by run number on bit 1, so it is independent of the AI
// family (bit 0, lib/engine.mjs pickFamily): runs 0,1 sqlite, 2,3 stand-in, and every family meets every store. A Mac with nothing pinned: the
// stand-in (no token, and every suite's Notion path as before).
export function pickStore({env = process.env, suiteStore = ''} = {}) {
  if (suiteStore) {
    if (!STORES.includes(suiteStore)) throw new Error(`a suite's store must be ${STORES.join(', ')}, not "${suiteStore}"`);
    return suiteStore;
  }
  const pinned = env.E2E_STORE || (env.E2E_NOTION_STANDIN === '1' ? 'standin' : '');
  if (pinned && !['sqlite', 'standin', 'alternate'].includes(pinned)) throw new Error(`E2E_STORE must be sqlite, standin or alternate, not "${pinned}" (the real workspace is only for a suite that pins it)`);
  if (pinned && pinned !== 'alternate') return pinned;
  if (!isCi(env) && pinned !== 'alternate') return 'standin';
  return (Number(env.GITHUB_RUN_NUMBER || 0) >> 1) & 1 ? 'standin' : 'sqlite';
}

// The settings a fresh profile starts with for that store: only 'sqlite' is written; the Notion store is the app's default (no store chosen).
export const storeSettings = store => (store === 'sqlite' ? {store: 'sqlite'} : {});

// Where Notion's requests end for a store (the fault proxy's far side, lib/notion-proxy.mjs): the stand-in when there is one, real Notion only for the real
// workspace (or a suite with no store: notion = false), and a dead local port on this Mac's store, so a stray request fails instead of leaving the computer.
export function notionFarSide({store, standIn = ''}) {
  if (standIn) return standIn;
  if (store === 'notion' || !store) return 'https://api.notion.com';
  return 'http://127.0.0.1:9';
}

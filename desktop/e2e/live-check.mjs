// The per-site limit asked BEFORE npm run live waits for the heavy lock (a run queued 6 minutes and was then refused): exit 3 with the ledger's own words, nothing counted.
import {SiteLimitError, guardLiveVisit} from './lib/site-ledger.mjs';

const url = process.argv.slice(2).find(arg => /^https?:\/\//.test(arg));
if (url) {
  try { guardLiveVisit(url, {record: false}); }
  catch (error) { if (!(error instanceof SiteLimitError)) throw error; console.error(error.message); process.exit(3); }
}

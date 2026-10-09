// What a store can do beyond the contract (src/stores/base.py LINKS, CLOUD, FILES). The UI asks a capability, never an adapter's name.
export const LINKS = 'links';   // records have a page the user can open elsewhere ("Open in Notion")
export const CLOUD = 'cloud';   // reachable from GitHub runners and the Telegram worker (Always on)
export const FILES = 'files';   // files are kept in the store itself (else only on this Mac)

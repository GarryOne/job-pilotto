// The store's name for modules that run without the window's state (their node tests import them): renderer/store-words.js sets it
// from the window's state at start-up and whenever the store parts are shown again. Until then it is Notion, as store-words.js says.
let current = 'Notion';   // about Notion: the name before the state is read
export const where = () => current;
// One of two sentences: the Notion one, or the one for data on this Mac (as store-words.js byStore).
export const byWhere = (notion, mac) => (current === 'Notion' ? notion : mac);
export const setWhere = name => { current = name; };

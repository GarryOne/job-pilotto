// The browser's name and its own extensions page, in the wording of the extension card: "Chrome" and chrome://extensions
// become "Edge" and edge://extensions when that is the browser the extension is (or will be) installed in.
const BROWSERS = {'Google Chrome': ['Chrome', 'chrome'], 'Microsoft Edge': ['Edge', 'edge'], 'Brave Browser': ['Brave', 'brave'], Vivaldi: ['Vivaldi', 'vivaldi']};

export function browserWords(app) {
  const [name, scheme] = BROWSERS[app] || BROWSERS['Google Chrome'];
  return {name, scheme, extensionsUrl: `${scheme}://extensions`};
}

// Chrome's wording -> that browser's. Text without Chrome in it is untouched ("Claude in Chrome" is another product: keep it out of what this reads).
export function inBrowser(text, app) {
  const {name, scheme} = browserWords(app);
  return String(text).replace(/chrome:\/\/extensions/g, `${scheme}://extensions`).replace(/\bChrome\b/g, name);
}

// Every text node under `root` (except those inside an element matching the selector `skip`), rewritten from its original so a second call with another browser starts from Chrome's words.
const originals = new WeakMap();
export function retarget(root, app, skip = '') {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (skip && node.parentElement?.closest(skip)) continue;
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    node.nodeValue = inBrowser(originals.get(node), app);
  }
}

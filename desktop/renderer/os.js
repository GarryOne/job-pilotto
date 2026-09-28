// The window's words are written for the Mac; on Windows these swaps name the PC's equivalents.
const WINDOWS = [
  [/your Mac's Keychain/g, "Windows' built-in encryption"],
  [/\b(this|my|your|the) Mac\b/g, '$1 PC'],
  [/Show in Finder/g, 'Show in File Explorer'],
  [/in Finder\b/g, 'in File Explorer'],
  [/⌘-click/g, 'Ctrl-click'],
  [/⌘K/g, 'Ctrl+K'],
];

export function osText(text, platform) {
  return platform === 'win32' ? WINDOWS.reduce((out, [from, to]) => out.replace(from, to), String(text)) : text;
}

// Every text node and tooltip under root, once at start (dynamic messages call osText themselves).
export function localize(root, platform) {
  if (platform !== 'win32') return;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = osText(node.nodeValue, platform);
  for (const el of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const name of ['title', 'placeholder', 'aria-label']) if (el.hasAttribute(name)) el.setAttribute(name, osText(el.getAttribute(name), platform));
  }
}

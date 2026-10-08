// The window's words are written for the Mac; on Windows these swaps name the PC's equivalents. Order matters: the
// two-key combinations are swapped before their second key alone (⌘⇧G before ⌘G), and the bare ⌘ last.
const WINDOWS = [
  [/your Mac[’']s Keychain/g, "Windows' built-in encryption"],   // the straight and the curly apostrophe: both are in the window's text
  [/\b(this|the) Mac[’']s Keychain\b/gi, 'Windows Credential Manager'],   // the PC's secret store (src/secret_store.py: keyring)
  [/\b(this|my|your|the) Mac\b/gi, '$1 PC'],   // case kept as written: "This Mac's version" -> "This PC's version"
  [/\bKeychain\b/g, 'Windows Credential Manager'],
  [/Show in Finder/g, 'Show in File Explorer'],
  [/in Finder\b/g, 'in File Explorer'],
  [/⌘-click/g, 'Ctrl-click'],
  [/[⌘]⇧G|⇧⌘G/g, 'Ctrl+Shift+G'],
  [/⌘K/g, 'Ctrl+K'],
  [/⌘R/g, 'Ctrl+R'],
  [/⌘L/g, 'Ctrl+L'],
  [/⌘V/g, 'Ctrl+V'],
  [/⌘G/g, 'Ctrl+G'],
  [/⇧Enter/g, 'Shift+Enter'],
  [/⏎/g, 'Enter'],
  [/⌘/g, 'Ctrl+'],
];

export function osText(text, platform) {
  return platform === 'win32' ? WINDOWS.reduce((out, [from, to]) => out.replace(from, to), String(text)) : text;
}

// A whole sentence that differs by platform, where swapping words won't do: "Load unpacked, then ⌘⇧G" has no PC
// equivalent at all (its folder dialog has no Go to Folder), so the PC gets its own instruction.
export const pick = (mac, windows, platform) => (platform === 'win32' ? windows : mac);

const ATTRS = ['title', 'placeholder', 'aria-label'];

// Every text node and tooltip at or under node (a text node, an element, the body).
function swapTree(node, platform) {
  if (node.nodeType === 3) {
    const text = osText(node.nodeValue, platform);
    if (text !== node.nodeValue) node.nodeValue = text;   // only on a change: the observer below sees its own edits
    return;
  }
  if (node.nodeType !== 1) return;
  const walker = node.ownerDocument.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) swapTree(text, platform);
  for (const el of [node, ...node.querySelectorAll('[title], [placeholder], [aria-label]')]) {
    for (const name of ATTRS) if (el.hasAttribute?.(name)) {
      const value = osText(el.getAttribute(name), platform);
      if (value !== el.getAttribute(name)) el.setAttribute(name, value);
    }
  }
}

// Once at start, then for good: a card drawn later (Claude Code status, a run result, a message from the main process) is swapped
// the moment it appears, so no dynamic string needs its own osText call (owner's friend on Windows saw "Not installed on this Mac").
export function localize(root, platform, Observer = globalThis.MutationObserver) {
  if (platform !== 'win32') return;
  for (const el of root.querySelectorAll?.('[data-mac-only]') || []) el.hidden = true;   // a tip that only the Mac has (the folder picker's ⌘⇧G)
  swapTree(root, platform);
  if (!Observer) return;
  new Observer(records => {
    for (const record of records) {
      if (record.type === 'childList') for (const added of record.addedNodes) swapTree(added, platform);
      else swapTree(record.target, platform);   // characterData (a text node) or attributes (an element: swapTree reads only the watched ones)
    }
  }).observe(root, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS});
}

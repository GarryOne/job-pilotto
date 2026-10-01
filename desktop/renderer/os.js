// The window's words are written for the Mac; on Windows these swaps name the PC's equivalents. Order matters: the
// two-key combinations are swapped before their second key alone (⌘⇧G before ⌘G), and the bare ⌘ last.
const WINDOWS = [
  [/your Mac's Keychain/g, "Windows' built-in encryption"],
  [/\b(this|my|your|the) Mac\b/g, '$1 PC'],
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

// Every text node and tooltip under root, once at start (dynamic messages call osText themselves).
export function localize(root, platform) {
  if (platform !== 'win32') return;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = osText(node.nodeValue, platform);
  for (const el of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const name of ['title', 'placeholder', 'aria-label']) if (el.hasAttribute(name)) el.setAttribute(name, osText(el.getAttribute(name), platform));
  }
}

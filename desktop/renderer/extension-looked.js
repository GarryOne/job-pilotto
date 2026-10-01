// The line under the extension's install steps: where the app looked for the browser profiles on this computer.
// Renderer code, so the list comes in as an argument rather than being read here (renderer/os.js sets the precedent).
//
// It exists for the machine where the extension isn't found and the reason isn't "it isn't installed": a browser this
// app doesn't know, or one started with --user-data-dir, keeps its profile somewhere no list here can guess. The
// browser itself knows — chrome://version prints its Profile Path — so the words say where to look instead.
const list = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : String(items[0] || ''));

export function lookedText(looked) {
  if (!looked?.length) return '';
  const here = looked.filter(entry => entry.there).map(entry => entry.dir);
  return [`Looked in ${list(looked.map(entry => entry.dir))}.`,
    here.length ? `On this computer: ${list(here)}.`
      : 'None of those folders is on this computer: a browser started with --user-data-dir, or one this app doesn\'t '
        + 'know, keeps its profile somewhere else — chrome://version shows the browser\'s real Profile Path.'].join(' ');
}

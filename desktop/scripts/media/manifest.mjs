// The product media's manifest.json (desktop/scripts/media): one entry per file set, the shape agreed with the site redesign (session bd,
// 20 Oct 2026). The site takes the files as they are and writes its own text beside them; captions are here, never burned in. Pure.
// Guard: desktop/test/media-manifest.test.js.

export const VERSION = 1;

// video: {name, piece, files, bytes, width, height, seconds} | still: {name, kind: 'still'|'snip', file, bytes, width, height, shows}
export function videoEntry({name, piece, files, bytes, seconds}) {
  return {name, kind: 'video', theme: 'dark', shows: piece.shows, caption: piece.caption, alt: piece.alt,
    files: {mp4: files.mp4, webm: files.webm, gif: files.gif || null, poster: files.poster, phone: files.phone || null, png: null},
    width: piece.width, height: piece.height, duration_s: Number(seconds.toFixed(1)), bytes};
}

export function stillEntry({name, kind, file, bytes, width, height, shows}) {
  return {name, kind, theme: 'dark', shows, caption: null, alt: shows,
    files: {mp4: null, webm: null, gif: null, poster: null, phone: null, png: null, webp: file}, width, height, duration_s: null, bytes: {webp: bytes}};
}

// made: {sha, at, persona}. A partial run (some pieces) keeps the other entries of the folder's earlier manifest.
export function manifest({entries, made, previous = null}) {
  const names = new Set(entries.map(entry => `${entry.kind}:${entry.name}`));
  const kept = (previous?.items || []).filter(entry => !names.has(`${entry.kind}:${entry.name}`));
  const items = [...kept, ...entries].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return {version: VERSION, made_from: made.sha, made_at: made.at, persona: made.persona, items};
}

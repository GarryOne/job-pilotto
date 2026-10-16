// Whether text is a board's address for "Read this board": https, no password in it (the same test as lib/visits.js boardSite). Pure.
export const validBoard = text => { try { const url = new URL(String(text || '').trim()); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };

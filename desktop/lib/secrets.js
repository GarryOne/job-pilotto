// Pasted keys and tokens: drop what copying adds (spaces, line breaks, invisible characters) and
// catch look-alike letters from another keyboard layout, which no API key contains.
const INVISIBLE = /[\s ​-‍⁠﻿]/g;

export function cleanSecret(value) {
  const cleaned = String(value ?? '').replace(INVISIBLE, '');
  const bad = [...cleaned].findIndex(char => char < '!' || char > '~');
  if (bad === -1) return {value: cleaned};
  const char = [...cleaned][bad];
  const code = `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  return {error: `Character ${bad + 1} ("${char}", ${code}) can't be part of a key: it looks like a letter ` +
    'from another keyboard layout or text editor. Copy the key again with its copy button and paste it here.'};
}

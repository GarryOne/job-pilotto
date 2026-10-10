// A small ZIP reader on node:zlib (no dependency): list the entries of a .zip file and read chosen ones, from the central directory,
// without loading the whole archive (a full LinkedIn export can be large). Stored and deflated entries only; ZIP64 is refused with a
// clear error. Used by lib/linkedin-export.js. Guarded by test/linkedin-export.test.js.
import fs from 'node:fs';
import zlib from 'node:zlib';

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
export const MAX_ENTRY_BYTES = 50 * 1024 * 1024;   // one CSV of a profile is kilobytes; a bigger entry is not one we want

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  const got = fs.readSync(fd, buffer, 0, length, position);
  return got === length ? buffer : buffer.subarray(0, got);
}

// [{name, method, compressed, size, offset}] for every file entry.
export function listZip(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const total = fs.fstatSync(fd).size;
    const tailLength = Math.min(total, 65557);
    const tail = readAt(fd, total - tailLength, tailLength);
    let at = tail.length - 22;
    while (at >= 0 && tail.readUInt32LE(at) !== EOCD) at--;
    if (at < 0) throw new Error('This is not a ZIP file.');
    const count = tail.readUInt16LE(at + 10), size = tail.readUInt32LE(at + 12), offset = tail.readUInt32LE(at + 16);
    if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new Error('This ZIP is too large to read here (ZIP64). Export only the profile data, not the full archive.');
    const directory = readAt(fd, offset, size);
    const entries = [];
    for (let position = 0, n = 0; n < count && position + 46 <= directory.length; n++) {
      if (directory.readUInt32LE(position) !== CENTRAL) throw new Error('This ZIP is damaged.');
      const nameLength = directory.readUInt16LE(position + 28), extra = directory.readUInt16LE(position + 30), comment = directory.readUInt16LE(position + 32);
      const name = directory.toString('utf8', position + 46, position + 46 + nameLength);
      if (!name.endsWith('/')) entries.push({name, method: directory.readUInt16LE(position + 10), compressed: directory.readUInt32LE(position + 20),
        size: directory.readUInt32LE(position + 24), offset: directory.readUInt32LE(position + 42)});
      position += 46 + nameLength + extra + comment;
    }
    return entries;
  } finally { fs.closeSync(fd); }
}

export function readEntry(file, entry) {
  if (entry.size > MAX_ENTRY_BYTES) throw new Error(`${entry.name} is too large to read.`);
  const fd = fs.openSync(file, 'r');
  try {
    const head = readAt(fd, entry.offset, 30);
    if (head.readUInt32LE(0) !== LOCAL) throw new Error('This ZIP is damaged.');
    const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const data = readAt(fd, start, entry.compressed);
    if (entry.method === 0) return data;
    if (entry.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`${entry.name} uses a compression this reader does not know.`);
  } finally { fs.closeSync(fd); }
}

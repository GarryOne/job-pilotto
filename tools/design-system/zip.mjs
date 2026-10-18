// A minimal, deterministic zip writer (stored, no compression, fixed timestamp) so the snapshot's bytes only change when its files do.
import zlib from 'node:zlib';

const crcOf = buffer => zlib.crc32 ? zlib.crc32(buffer) : slowCrc(buffer);
function slowCrc(buffer) {
  let crc = ~0;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1)); }
  return ~crc >>> 0;
}
const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 10 << 5 | 18;   // 18 Oct 2026 00:00, never "now"

// files: [{name, data: Buffer|string}] in the order given -> Buffer.
export function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crcOf(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(DOS_TIME, 12); entry.writeUInt16LE(DOS_DATE, 14); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, name, data); central.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

// A PDF content stream read as operators: each with its operands and its byte range (first operand to end of operator), so lib/pdf-edit/write.js
// can replace exactly the operators it edits and leave every other byte alone. Strings come back as bytes. Guards: test/pdf-edit.test.js.
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
export function lex(bytes) {
  const ops = [];
  let i = 0, operands = [], start = -1;
  const n = bytes.length;
  const push = (value, at) => { if (start < 0) start = at; operands.push(value); };
  while (i < n) {
    const c = bytes[i];
    if (WS.has(c)) { i++; continue; }
    if (c === 37) { while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++; continue; }
    const at = i;
    if (c === 40) { // literal string
      let depth = 1, out = []; i++;
      while (i < n && depth) {
        let b = bytes[i];
        if (b === 92) { i++; b = bytes[i];
          const map = {110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92};
          if (b in map) { out.push(map[b]); i++; }
          else if (b >= 48 && b <= 55) { let v = 0, k = 0; while (k < 3 && bytes[i] >= 48 && bytes[i] <= 55) { v = v * 8 + bytes[i] - 48; i++; k++; } out.push(v & 255); }
          else if (b === 13) { i++; if (bytes[i] === 10) i++; }
          else if (b === 10) i++;
          else { out.push(b); i++; }
          continue; }
        if (b === 40) depth++; else if (b === 41) { depth--; if (!depth) { i++; break; } }
        out.push(b); i++;
      }
      push({str: Uint8Array.from(out)}, at); continue;
    }
    if (c === 60 && bytes[i + 1] === 60) { push({tok: '<<'}, at); i += 2; continue; }
    if (c === 62 && bytes[i + 1] === 62) { push({tok: '>>'}, at); i += 2; continue; }
    if (c === 60) { i++; let hex = ''; while (i < n && bytes[i] !== 62) { if (!WS.has(bytes[i])) hex += String.fromCharCode(bytes[i]); i++; } i++;
      if (hex.length % 2) hex += '0'; const out = new Uint8Array(hex.length / 2); for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.slice(2 * k, 2 * k + 2), 16);
      push({str: out}, at); continue; }
    if (c === 91 || c === 93) { push({tok: c === 91 ? '[' : ']'}, at); i++; continue; }
    if (c === 123 || c === 125) { push({tok: String.fromCharCode(c)}, at); i++; continue; }
    if (c === 47) { i++; let s = ''; while (i < n && !WS.has(bytes[i]) && !DELIM.has(bytes[i])) { s += String.fromCharCode(bytes[i]); i++; }
      push({name: s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))}, at); continue; }
    let s = ''; while (i < n && !WS.has(bytes[i]) && !DELIM.has(bytes[i])) { s += String.fromCharCode(bytes[i]); i++; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) { push({num: parseFloat(s)}, at); continue; }
    if (s === 'true' || s === 'false' || s === 'null') { push({tok: s}, at); continue; }
    // an operator
    const op = {op: s, operands, start: start < 0 ? at : start, end: i};
    if (s === 'BI') { // inline image: skip to EI after ID
      while (i < n && !(bytes[i] === 73 && bytes[i + 1] === 68 && WS.has(bytes[i + 2]))) i++;
      i += 3;
      while (i < n && !(WS.has(bytes[i - 1]) && bytes[i] === 69 && bytes[i + 1] === 73 && (i + 2 >= n || WS.has(bytes[i + 2])))) i++;
      i += 2; op.end = i; op.op = 'BI…EI';
    }
    ops.push(op); operands = []; start = -1;
  }
  return ops;
}
export const SHOW = new Set(['Tj', 'TJ', "'", '"']);

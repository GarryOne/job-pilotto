// The LibreOffice add-on for real on this computer (CI: .github/workflows/office-addon.yml on Mac and Windows): download, checksum,
// unpack into a temp folder, then draw a made-up Word CV (test/fixtures/cv-docx) to PDF. Prints each step and the timings; exit 1 on failure.
//   node scripts/office-proof.mjs [<work folder>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installOffice, officePdf} from '../lib/office.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const work = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'jp-office-proof-'));
const t0 = Date.now(), secs = () => `${Math.round((Date.now() - t0) / 1000)} s`;
let last = '', lastTenth = -1;
const soffice = await installOffice(path.join(work, 'office'), {work, onProgress: ({step, share, bytes}) => {
  const tenth = share === null || share === undefined ? -1 : Math.floor(share * 10);
  if (step !== last || (step === 'download' && tenth !== lastTenth)) console.log(`office-proof: ${step}${step === 'download' ? ` ${Math.round(bytes / 1048576)} MB` : ''} (${secs()})`);
  last = step; lastTenth = tenth;
}});
console.log(`office-proof: installed ${soffice} (${secs()})`);
for (const name of ['classic.docx', 'table.docx']) {
  const t1 = Date.now();
  const pdf = await officePdf(soffice, fs.readFileSync(path.join(here, '..', 'test', 'fixtures', 'cv-docx', name)), {profile: path.join(work, 'profile'), work});
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')) || !pages) throw new Error(`${name}: not a PDF`);
  console.log(`office-proof: ${name} -> PDF, ${pages} page(s), ${pdf.length} bytes, ${Math.round((Date.now() - t1) / 1000)} s`);
}
console.log('office-proof: OK');

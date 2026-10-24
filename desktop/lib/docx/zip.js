// A Word file opened and written back with only word/document.xml changed: every other part (styles, fonts, pictures, numbering) is
// copied as it was. Guards: test/docx-edit.test.js.
import JSZip from 'jszip';

const BODY = 'word/document.xml';

// bytes: the .docx. -> {zip, xml}; throws a plain sentence when the file is not a Word document.
export async function readDocx(bytes) {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('This file is not a Word document (.docx).'); }
  const body = zip.file(BODY);
  if (!body) throw new Error('This Word file has no document body.');
  return {zip, xml: await body.async('string')};
}

export async function writeDocx(zip, xml) {
  zip.file(BODY, xml);
  return zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

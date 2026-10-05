// An exam for the verdict pass (5 Oct 2026). The weekly audit measures the judge by asking the owner to tick five verdicts; that is the one place a person is still needed to say whether the
// judge was right. The exam asks the same question with answers already known: ten findings from this loop's own history (four real, six false) each with the code as it was at the build
// that was tested, run through the verdict pass exactly as a real finding is, and scored against what was later proven. A judge that dismisses a real bug or believes a false alarm
// shows it in a number every week, with no one ticking anything. The same idea as the recall plants (a known bug, did the detector see it), pointed at the judge. Pure but for reading the fixtures.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from './verdict-comment.mjs';

export const EXAM_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'judge-exam');
export const EXPECTED = ['real', 'false-positive', 'harness'];

// -> [{id, expect, cause, note, finding, code: [absolute paths]}]
export function loadExam(dir = EXAM_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => {
    const folder = path.join(dir, entry.name);
    const finding = JSON.parse(fs.readFileSync(path.join(folder, 'finding.json'), 'utf8'));
    const codeDir = path.join(folder, 'code');
    return {id: finding.id, expect: finding.expect, cause: finding.cause || '', note: finding.note || '', finding, codeDir, code: fs.existsSync(codeDir) ? fs.readdirSync(codeDir).map(name => path.join(codeDir, name)) : []};
  }).sort((a, b) => a.id.localeCompare(b.id));
}

// The findings as the verdict pass receives them (lib/prejudge.mjs prejudgePrompt), with a pointer to the code of each: no screenshot, and the code is the excerpt as of its build.
export const examPending = items => items.map(({id, finding}) => ({id, view: finding.view, kind: finding.kind, severity: finding.severity, source: finding.source, title: finding.title,
  detail: `${finding.detail}\n(The app's code for this finding is the excerpt in .heal/exam/${id}/code/ : read those files, not the repository, and cite them as file:line with the numbers printed in the excerpt.)`, impact: finding.impact || '', workaround: '', screenshot: ''}));

// verdicts: {id: raw verdict text} (lib/prejudge.mjs parseVerdicts) -> {right, wrong, missing, total, rate, dismissed, believed, rows}.
export function scoreExam(items, verdicts = {}) {
  const rows = items.map(item => {
    const raw = verdicts[item.id];
    const parsed = raw ? parse(raw) : null;
    const got = parsed?.word || '';
    return {id: item.id, expect: item.expect, got: got || 'none', right: got === item.expect, cause: parsed?.cause || '', note: item.note};
  });
  const right = rows.filter(row => row.right).length, missing = rows.filter(row => row.got === 'none').length;
  return {v: 1, at: new Date().toISOString(), total: rows.length, right, wrong: rows.length - right - missing, missing, rate: rows.length ? Math.round(100 * right / rows.length) : null,
    dismissed: rows.filter(row => row.expect === 'real' && (row.got === 'false-positive' || row.got === 'harness')).length,   // a real bug the judge threw away
    believed: rows.filter(row => row.expect !== 'real' && row.got === 'real').length,                                       // a false alarm the judge confirmed
    rows};
}

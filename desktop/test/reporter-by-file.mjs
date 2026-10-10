// A node:test reporter that prints one line per test FILE, OK or FAILED, and the full error of every failing test (owner, 10 Oct 2026: "100-1000 lines with OK/Failed
// and the error if there is one": without a terminal node --test prints TAP, 6 lines a test, 10,000 lines for this suite). Used by `npm test` (package.json).
// Guarded by test/reporter-by-file.test.js.
import path from 'node:path';

// The error's own lines, without Node's runner frames (node:internal, node:async_hooks): the first frames of the test file are what a person needs.
const clip = (text, lines) => String(text || '').split('\n').filter(line => !/node:(internal|async_hooks)/.test(line)).slice(0, lines).join('\n');

export default async function* byFile(source) {
  const files = new Map();
  const of = data => {
    const file = path.relative(process.cwd(), data.file || '(unknown file)');
    if (!files.has(file)) files.set(file, {pass: 0, fail: 0, skipped: 0, ms: 0, failures: []});
    return files.get(file);
  };
  let diagnostics = [];
  for await (const {type, data} of source) {
    if (type === 'test:pass' || type === 'test:fail') {
      if (data.details?.type === 'suite') continue;   // a suite is its tests; counting it twice would show a pass for a failing file
      const entry = of(data);
      if (data.skip || data.todo) entry.skipped++;
      else if (type === 'test:pass') entry.pass++;
      else {
        const error = data.details?.error;
        if (error?.code === 'ERR_TEST_FAILURE' && /subtests? failed/.test(error.message || '')) continue;   // the parent of a failing subtest: the subtest is listed itself
        entry.fail++;
        entry.failures.push({name: data.name, message: clip(error?.cause?.stack || error?.cause?.message || error?.stack || error?.message || String(error || ''), 25)});
      }
      if (nesting(data) === 0) entry.ms += data.details?.duration_ms || 0;
    } else if (type === 'test:diagnostic' && !/^(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(data.message)) diagnostics.push(data.message);
  }
  let pass = 0, fail = 0, skipped = 0;
  for (const [file, entry] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    pass += entry.pass; fail += entry.fail; skipped += entry.skipped;
    const count = `${entry.pass + entry.fail} test${entry.pass + entry.fail === 1 ? '' : 's'}`;
    yield `${entry.fail ? 'FAILED' : 'OK    '}  ${file}  (${count}, ${Math.round(entry.ms)} ms)\n`;
    for (const failure of entry.failures) yield `    ✖ ${failure.name}\n${failure.message.split('\n').map(line => `        ${line}`).join('\n')}\n`;
  }
  for (const message of diagnostics) yield `note: ${message}\n`;
  yield `\n${fail ? 'FAILED' : 'OK'}: ${files.size} files, ${pass + fail} tests, ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}\n`;
}
const nesting = data => data.nesting || 0;

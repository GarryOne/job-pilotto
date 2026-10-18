"""Finds the crashes in a persona search's log (tools/persona-search/run.mjs): a Traceback means a step of the search died, so its numbers
are thin and must never be reported as a clean run (18 Oct 2026: the job-board step crashed in all six recorded searches, no board was
read, and the thin numbers looked fine). Prints one JSON line: [{"step": <the last progress line before it>, "error": <its last line>}].
Usage: python3 tools/persona-search/crashes.py <run-N.log>. Tests: tests/test_persona_crashes.py."""
import json
import re
import sys

STEP = re.compile(r'^\[\d+s\] (?:⏳ )?([A-Z][^:·]*?)(?::| ·|$)')


def find(text):
    """Each Traceback in the log: the step that was running (the last "Reading job boards"-style progress line before it) and its error line."""
    found, step, lines = [], '', text.splitlines()
    for number, line in enumerate(lines):
        body = re.sub(r'^\[\d+s\] ', '', line)
        if body.startswith('⏳ '):
            step = re.split(r':| ·', body[2:])[0].strip()
        if body.startswith('Traceback (most recent call last)'):
            end = number + 1
            while end < len(lines) and re.sub(r'^\[\d+s\] ', '', lines[end]).startswith((' ', '\t', '^')):
                end += 1
            error = re.sub(r'^\[\d+s\] ', '', lines[end]) if end < len(lines) else 'no error line'
            found.append({'step': step or 'unknown step', 'error': error[:200]})
    return found


if __name__ == '__main__':
    print(json.dumps(find(open(sys.argv[1], encoding='utf-8', errors='replace').read()), ensure_ascii=False))

#!/usr/bin/env python3
"""Real forms for the apply suite, from the extension's fill log: the forms it failed on for a real person, rebuilt as fixtures.

    python3 tools/fixture-from-fills.py [--days 14] [--max 5] [--out desktop/e2e/fixtures/real-forms]

Reads the same Agent Runs as tools/fill-failures.py and writes one JSON per run that left a required field: the board family and,
per field it failed on, the LABEL and a kind guessed from why it failed (text, textarea, select, checkbox, widget). Never a value,
a name or a URL: only public form wording. The apply suite (desktop/e2e/lib/forms.mjs REAL_FORMS) then requires the extension to
list each of those fields as left for the person, by name. Review the files before committing them.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PERSONAL = re.compile(r'@|https?://|\+?\d[\d\s()-]{7,}')   # an e-mail, a link or a phone number is never a label worth keeping
UPLOAD = re.compile(r'^(cv|resume|résumé|curriculum|cover letter)\b', re.I)   # a file upload: every fixture form already has its own
CONTACT = re.compile(r'^(first|last|full|given|family|sur)?\s*name\b|^e-?mail|^phone|^mobile', re.I)   # the person's details: every fixture asks for them itself and requires them FILLED
NO_LABEL = re.compile(r'^[a-z]+[-_]\d+$', re.I)   # a site's internal id ("text-3219"): the field had no label, nothing to learn from


def kind_of(label, why):
    text = f'{label} {why}'.lower()
    if re.search(r'widget|custom|combobox|listbox|autocomplete|typeahead', text):
        return 'widget'
    if re.search(r'option|select|dropdown|choice', text):
        return 'select'
    if re.search(r'checkbox|tick|agree|consent', text):
        return 'checkbox'
    if len(label) > 60 or re.search(r'\b(describe|why|tell us|explain|cover letter)\b', text):
        return 'textarea'
    return 'text'


def spec_of(run):
    """One run of the fill log -> a fixture spec, or None when nothing required was left (consent is left on purpose)."""
    fields = []
    for field in run.get('trace', []):
        label, why = (field.get('label') or '').strip(), (field.get('why') or '').strip()
        if field.get('result', '').startswith('✅') or why.startswith('legal/consent') or not label or PERSONAL.search(label) or UPLOAD.search(label) or NO_LABEL.search(label) or CONTACT.search(label):
            continue
        if (field.get('required') or '').lower() not in ('yes', 'true', '✓', '*', 'required'):
            continue
        fields = [item for item in fields if item['label'] != label[:160]]   # one field tried twice in a run: its last try says what it is
        fields.append({'label': label[:160], 'kind': kind_of(label, why), 'required': True})
    if not fields:
        return None
    ats = (run.get('ats') or 'other').lower()
    ats = next((name for name in ('greenhouse', 'lever', 'workday') if name in ats), 'other')
    digest = hashlib.sha1(json.dumps([ats, [f['label'] for f in fields]]).encode()).hexdigest()[:8]
    return {'id': f'{ats}-{digest}', 'ats': ats, 'title': 'Engineer (a real form)', 'fields': fields[:12]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--days', type=int, default=14)
    parser.add_argument('--max', type=int, default=5)
    parser.add_argument('--out', default=str(ROOT / 'desktop' / 'e2e' / 'fixtures' / 'real-forms'))
    args = parser.parse_args(argv)
    spec = importlib.util.spec_from_file_location('fill_failures', ROOT / 'tools' / 'fill-failures.py')
    log = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(log)
    settings = log.app_settings()
    database = os.getenv('NOTION_AGENT_RUNS_DB') or settings.get('notionIds', {}).get('NOTION_AGENT_RUNS_DB')
    token = log.token_for(database, [os.getenv('NOTION_TOKEN', '')] + log.keychain_tokens()) if database else ''
    if not token or not database:
        sys.exit('No Notion token on this Mac can open the app\'s Agent Runs database (see tools/fill-failures.py).')
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    written = 0
    for run in log.runs(token, database, since):
        made = spec_of(run)
        if not made or (out / f"{made['id']}.json").exists():
            continue
        (out / f"{made['id']}.json").write_text(json.dumps(made, indent=1, ensure_ascii=False) + '\n')
        print(f"{made['id']}: {len(made['fields'])} field(s) left on a {made['ats']} form")
        written += 1
        if written >= args.max:
            break
    print(f'{written} real form(s) written to {out}. Review them, then commit.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

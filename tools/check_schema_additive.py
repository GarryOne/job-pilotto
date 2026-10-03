#!/usr/bin/env python3
"""May this build go to beta testers? Its Notion schema (config/notion_schema.json) must be ADDITIVE over the current stable's.

    python3 tools/check_schema_additive.py <stable-schema.json> <candidate-schema.json>      exit 1 and print each break

Why: "Back to stable" installs the older app over the newer one. At start-up the app creates every database, page and column its own schema expects and does not find
(desktop/lib/migrate.js 'workspace'). If a beta REMOVED or RENAMED something, rolling back recreates the old one empty next to the new one and splits the person's data.
Adding databases, pages, columns and select options is always safe; removing or retyping any of them is not (a `retired` column list entry is the one deliberate removal,
and only counts if the stable already listed it).
"""
import json
import sys


def breaks(stable, candidate):
    found = []
    for key, old in (stable.get('databases') or {}).items():
        new = (candidate.get('databases') or {}).get(key)
        if new is None:
            found.append(f"database {key} ({old.get('title')}) is gone")
            continue
        if old.get('title') != new.get('title') and old.get('title') not in (new.get('former_titles') or []) and new.get('title') not in (old.get('former_titles') or []):
            found.append(f"database {key} was renamed from '{old.get('title')}' to '{new.get('title')}' without listing the old title in former_titles")
        elif old.get('title') != new.get('title'):
            found.append(f"database {key} was renamed from '{old.get('title')}' to '{new.get('title')}': the older app would not find it by that title")
        old_retired = set(old.get('retired') or [])
        for column, spec in (old.get('columns') or {}).items():
            if column in old_retired:
                continue
            now = (new.get('columns') or {}).get(column)
            if now is None:
                if column not in set(new.get('retired') or []) or column in old_retired:
                    found.append(f"{key}: column '{column}' was removed")
                else:
                    found.append(f"{key}: column '{column}' was retired in this build (the older app would recreate it empty)")
            elif now.get('type') != spec.get('type'):
                found.append(f"{key}: column '{column}' changed type from {spec.get('type')} to {now.get('type')}")
            else:
                gone = {o.get('name') for o in spec.get('options') or []} - {o.get('name') for o in now.get('options') or []}
                if gone:
                    found.append(f"{key}: column '{column}' lost option(s) {sorted(gone)}")
    for key, old in (stable.get('pages') or {}).items():
        new = (candidate.get('pages') or {}).get(key)
        if new is None:
            found.append(f"page {key} ({old.get('title')}) is gone")
        elif old.get('title') != new.get('title'):
            found.append(f"page {key} was renamed from '{old.get('title')}' to '{new.get('title')}'")
    return found


def main(argv):
    if len(argv) != 3:
        print(__doc__)
        return 2
    with open(argv[1]) as a, open(argv[2]) as b:
        problems = breaks(json.load(a), json.load(b))
    for problem in problems:
        print(f"NOT ADDITIVE: {problem}")
    print(f"{len(problems)} break(s): a beta must not change the Notion schema in a way that 'Back to stable' cannot undo." if problems else 'Schema is additive over stable.')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

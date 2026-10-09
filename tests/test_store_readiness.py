"""Ready to keep the data on this Mac (desktop/lib/store-handlers.js STORE_CHOICE, on): no bridge is left, and outside src/notion and
src/stores the engine talks to Notion only where this list says why. Each entry is a Notion client made or a raw Notion request,
and each is reachable only while the active store is Notion, or is a check of Notion itself. A new one fails here: put it behind
the store (src/stores), or add it with its reason. An entry that is gone fails too, so the list only shrinks.
Spec: docs/superpowers/specs/2026-10-09-store-adapters.md (release gate)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BEHIND = ('src/notion/', 'src/stores/')

# What counts: a Notion client made (Tracker(...), Tracker.from_env()) or a raw request on one.
KINDS = {
    'client': re.compile(r'\bTracker(\.from_env)?\('),
    'request': re.compile(r'\.(_request|query_database|create_page|update_page)\('),
}

ALLOWED = {
    # A check of Notion itself (Settings → doctor, the connection ping and the setup's database check).
    ('src/doctor.py', 'client'): 'the doctor checks the Notion connection when there is one',
    ('src/doctor.py', 'request'): 'the doctor pings users/me',
    # A client made once, handed to src/store_access.run_stores / open_stores(tracker=): kept only while the active store is Notion
    # (JOB_PILOTTO_STORE from the app; NOTION_TOKEN alone for Always on and the terminal, D7).
    ('src/daily.py', 'client'): 'run_stores: the tracker only while the store is Notion (Always on runs here)',
    ('src/scout.py', 'client'): 'employer_store: the tracker only while the store is Notion',
    ('src/desktop.py', 'client'): 'run_stores / open_stores(tracker=): the app passes JOB_PILOTTO_STORE',
    ('src/ai/inbox.py', 'client'): 'open_stores(tracker=): the app passes JOB_PILOTTO_STORE',
    # A request on that tracker, reached only when it is set (the store is Notion).
    ('src/daily_modes.py', 'request'): "the run's 'Job logged' line reads the Notion page; another store links its record",
    ('src/daily_helpers.py', 'request'): 'the Notion job finder (Job Matches rows) for a tracker run',
    ('src/ledger_store.py', 'request'): 'the Notion store serves no matches / agent runs yet: its rows, as before',
}


def found():
    uses = {}
    for path in sorted((ROOT / 'src').rglob('*.py')):
        rel = path.relative_to(ROOT).as_posix()
        if rel.startswith(BEHIND):
            continue
        for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            code = line.split('#', 1)[0]
            for kind, pattern in KINDS.items():
                if pattern.search(code):
                    uses.setdefault((rel, kind), []).append(number)
    return uses


def bridges():
    marker = re.compile(r'(#|//)\s*BRIDGE\(')
    files = [p for top in ('src', 'desktop') for p in (ROOT / top).rglob('*')
             if p.suffix in ('.py', '.js', '.mjs', '.cjs') and not {'node_modules', 'shared', 'dist', 'out'} & set(p.parts)
             and p.name != 'bridge-registry.test.js']
    return [f'{p.relative_to(ROOT)}:{n}' for p in files for n, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1)
            if marker.search(line)]


class StoreReadinessTest(unittest.TestCase):
    def test_no_bridge_is_left(self):
        self.assertEqual(bridges(), [])

    def test_the_engine_talks_to_notion_only_where_the_list_says_why(self):
        uses = found()
        new = {f'{file}:{lines[0]} ({kind})' for (file, kind), lines in uses.items() if (file, kind) not in ALLOWED}
        self.assertEqual(new, set(), 'a Notion client or request outside src/notion and src/stores: put it behind the store, or list it')
        gone = {f'{file} ({kind})' for file, kind in ALLOWED if (file, kind) not in uses}
        self.assertEqual(gone, set(), 'no longer there: remove it from ALLOWED')

    def test_the_scan_sees_both_kinds(self):
        self.assertTrue(KINDS['client'].search('tracker = notion.Tracker.from_env()'))
        self.assertTrue(KINDS['request'].search("tracker._request('GET', 'users/me')"))
        self.assertFalse(KINDS['client'].search('stores = open_stores()'))


if __name__ == '__main__':
    unittest.main()

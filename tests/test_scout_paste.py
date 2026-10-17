import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout_core, scout_paste

CLERA = """Your matches · SolveAI · London · Founding engineer
Zauber · Berlin · Forward Deployed Engineer
ZenML · San Francisco or remote · Platform engineer
Wynd Labs · remote · Research Crawling Engineer"""


class FakeClient:
    """Answers the extraction call with the companies it was built with; remembers what it was sent."""
    def __init__(self, companies):
        self.companies, self.sent = companies, []
        self.messages = self

    def create(self, **request):
        import json
        self.sent.append(request['messages'][0]['content'])
        return SimpleNamespace(stop_reason='end_turn', usage=None,
                               content=[SimpleNamespace(type='text', text=json.dumps({'companies': self.companies}))])


def memory_db():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    scout_core.ensure_tables(db)
    return db


NAMES = [{'name': 'SolveAI', 'website': ''}, {'name': 'Zauber', 'website': 'https://zauber.tech'}, {'name': 'ZenML', 'website': 'https://zenml.io'},
         {'name': 'Wynd Labs', 'website': ''}, {'name': 'https://evil.test', 'website': ''}]


class PasteTest(unittest.TestCase):
    def test_pasted_text_becomes_candidates_probed_first(self):
        db, client = memory_db(), FakeClient(NAMES)
        report = scout_paste.add(db, CLERA, client=client)
        self.assertEqual(report['new'], ['SolveAI', 'Zauber', 'ZenML', 'Wynd Labs'])
        self.assertIn('Zauber · Berlin', client.sent[0])
        rows = db.execute('SELECT name, priority, status, website FROM scout_candidates ORDER BY name').fetchall()
        self.assertEqual({row['name'] for row in rows}, {'SolveAI', 'Zauber', 'ZenML', 'Wynd Labs'})
        self.assertTrue(all(row['priority'] == scout_paste.PRIORITY and row['status'] == 'pending' for row in rows))
        self.assertGreater(scout_paste.PRIORITY, 92, 'pasted names must be probed before the AI ideas')

    def test_a_name_seen_before_is_reported_as_known_with_how_it_ended(self):
        db = memory_db()
        db.execute("INSERT INTO scout_candidates (key, name, origin, priority, status, added_at) VALUES ('zenml', 'ZenML', 'AI idea', 92, 'found', '2026-10-01')")
        report = scout_paste.add(db, CLERA, client=FakeClient(NAMES[:3]))
        self.assertEqual(report['new'], ['SolveAI', 'Zauber'])
        self.assertEqual(report['known'], [('ZenML', 'found')])
        self.assertIn('ZenML (already read)', scout_paste.summary(report))

    def test_empty_text_asks_no_ai(self):
        client = FakeClient(NAMES)
        self.assertEqual(scout_paste.add(memory_db(), '   ', client=client)['new'], [])
        self.assertEqual(client.sent, [])

    def test_an_address_is_read_once_and_its_text_extracted(self):
        fetched = []
        def get(url):
            fetched.append(url)
            return '<html><body><a href="https://zauber.tech">Zauber</a> builds tools</body></html>'
        client = FakeClient(NAMES[1:2])
        report = scout_paste.add(memory_db(), '  https://vc.test/portfolio  ', client=client, get=get)
        self.assertEqual(fetched, ['https://vc.test/portfolio'])
        self.assertIn('Zauber -> https://zauber.tech', client.sent[0])
        self.assertEqual(report['new'], ['Zauber'])

    def test_a_page_that_cannot_be_read_says_so(self):
        def get(url):
            raise OSError('403')
        report = scout_paste.add(memory_db(), 'https://login.test/match/1', client=FakeClient(NAMES), get=get)
        self.assertEqual(report['new'], [])
        self.assertIn('could not be read', scout_paste.summary(report))

    def test_from_file_reads_the_text_the_app_wrote(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'pasted-page.txt'
            path.write_text(CLERA, encoding='utf-8')
            self.assertEqual(scout_paste.read_file(path), CLERA)
            self.assertEqual(len(scout_paste.read_file(path, limit=10)), 10)


if __name__ == '__main__':
    unittest.main()

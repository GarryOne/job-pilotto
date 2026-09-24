import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import daily
import job_store


class DigestFormatTests(unittest.TestCase):
    def test_digest_is_escaped_telegram_html(self):
        report = {'jobs': [{'company': 'A&B <Labs>', 'id': '1', 'title': 'SRE <Platform> & Ops',
                            'location': 'Zurich', 'work_mode': 'Hybrid (stated)',
                            'url': 'https://example.test/jobs?id=1&x="y"'}]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                message = daily.format_digest(db)
        self.assertIn('1 new job', message)
        self.assertIn('<b>SRE &lt;Platform&gt; &amp; Ops</b>', message)
        self.assertIn('href="https://example.test/jobs?id=1&amp;x=&quot;y&quot;"', message)
        self.assertIn('🏢 A&amp;B &lt;Labs&gt;', message)
        self.assertIn('🔀 Hybrid', message)
        self.assertNotIn('<Labs>', message)

    def test_unknown_work_mode_is_omitted(self):
        self.assertIsNone(daily._work_mode_badge('Not stated'))
        self.assertEqual(daily._work_mode_badge('Remote mentioned; verify conditions'), '🌍 Remote?')


if __name__ == '__main__':
    unittest.main()

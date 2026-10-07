"""A page read in Chrome that is a job system the engine reads by itself (Chanel's Workday, 7 Oct 2026) becomes a normal feed."""
import contextlib
import io
import json
import pathlib
import sqlite3
import tempfile
import unittest
from unittest import mock

from src import desktop
from src.sources import visits


class AtsFeedTest(unittest.TestCase):
    def test_a_workday_page_read_in_chrome_becomes_a_workday_feed_named_after_the_site(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        page = tmp / 'page.json'
        page.write_text(json.dumps({'url': 'https://cc.wd3.myworkdayjobs.com/en-US/ChanelCareers', 'title': 'Search for Jobs', 'html': '<html></html>',
                                    'site': 'Chanel', 'cards': [{'title': 'Sales Advisor', 'url': '/en-US/ChanelCareers/job/Zurich/Sales-Advisor_R123456', 'lines': ['Zürich']}]}))
        with mock.patch.object(desktop, 'JOBS_DB', tmp / 'jobs.sqlite'), mock.patch.object(visits, 'STORE', tmp / 'visits.json'), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as said:
            desktop.main(['visit-read', str(page)])
        with sqlite3.connect(tmp / 'jobs.sqlite') as db:
            rows = db.execute("SELECT ats, slug, company FROM feed_sources WHERE ats != 'visit'").fetchall()
        self.assertEqual(rows, [('workday', 'cc.wd3.ChanelCareers', 'Chanel')])
        self.assertIn('read by every search from now on', said.getvalue())


if __name__ == '__main__':
    unittest.main()

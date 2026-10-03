"""Jobs from job-alert emails in the user's own Gmail (src/sources/job_alerts.py). Fake Gmail and model: no network, no AI."""
import base64
import json
import sqlite3
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import feeds, job_alerts  # noqa: E402

TITLE, PLACE = 'Site Reliability Engineer / Data Analyst', 'Zürich, Switzerland; Amsterdam, Netherlands'   # matches the example search and the owner's
HTML = (f'<a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=x&refId=y">{TITLE}</a><p>Acme AG · {PLACE}</p>'
        '<a href="https://www.linkedin.com/comm/jobs/view/4099999999/?x=1">Office Manager</a>'
        '<a href="https://www.linkedin.com/comm/jobs/alerts?x=1">Manage alerts</a><a href="https://evil.example/x">Win a prize</a>')


def payload(markup):
    return {'mimeType': 'multipart/alternative', 'parts': [{'mimeType': 'text/html', 'body': {'data': base64.urlsafe_b64encode(markup.encode()).decode()}}]}


class FakeGmail:
    def __init__(self, messages):
        self.messages, self.searched = messages, []

    def search(self, query, limit=50):
        self.searched.append(query)
        return list(self.messages) if 'linkedin' in query else []

    def get(self, url, params=None):
        return {'payload': payload(self.messages[url.rsplit('/', 1)[1]])}


class FakeClient:
    def __init__(self, answer):
        self.calls, self.answer = [], answer
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.answer))], usage=None)


ANSWER = {'jobs': [{'role': TITLE, 'employer': 'Acme AG', 'place': PLACE, 'link': 'https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=x&refId=y'},
                   {'role': 'Office Manager', 'employer': 'Beta', 'place': PLACE, 'link': 'https://www.linkedin.com/comm/jobs/view/4099999999/?x=1'},
                   {'role': 'Invented', 'employer': 'X', 'place': PLACE, 'link': 'https://www.linkedin.com/jobs/view/1111111111/'},
                   {'role': 'Prize', 'employer': 'X', 'place': PLACE, 'link': 'https://evil.example/x'}]}


class JobAlertTests(unittest.TestCase):
    def test_an_alert_email_becomes_your_matching_jobs_with_clean_links_and_its_source_named(self):
        db = sqlite3.connect(':memory:')
        client = FakeClient(ANSWER)
        with mock.patch.object(feeds, 'record', return_value='new'):
            report = job_alerts.scan(db, FakeGmail({'m1': HTML}), client)
        self.assertEqual([(j['title'], j['company'], j['url'], j['source']) for j in report['jobs']],
                         [(TITLE, 'Acme AG', 'https://www.linkedin.com/jobs/view/4012345678/', 'LinkedIn alert')])
        linkedin = report['sources'][0]
        self.assertEqual((linkedin['company'], linkedin['total'], linkedin['matches'], linkedin['emails']), ('LinkedIn alerts', 2, 1, 1))   # invented and foreign links dropped
        prompt = client.calls[0]['messages'][0]['content']
        self.assertIn('-> https://www.linkedin.com/comm/jobs/view/4012345678', prompt)
        self.assertNotIn('evil.example', prompt, 'only links to the job site are shown to the model')
        self.assertIn('untrusted', client.calls[0]['system'][0]['text'])

    def test_each_email_is_read_once(self):
        db = sqlite3.connect(':memory:')
        client = FakeClient(ANSWER)
        with mock.patch.object(feeds, 'record', return_value='new'):
            job_alerts.scan(db, FakeGmail({'m1': HTML}), client)
            job_alerts.scan(db, FakeGmail({'m1': HTML}), client)
        self.assertEqual(len(client.calls), 1)

    def test_links_are_cleaned_to_the_job_itself(self):
        self.assertEqual(job_alerts.canonical('https://www.linkedin.com/comm/jobs/view/senior-sre-4012345678?trk=x'), 'https://www.linkedin.com/jobs/view/4012345678/')
        self.assertEqual(job_alerts.canonical('https://ch.indeed.com/rc/clk?jk=0a1b2c3d4e5f6a7b&from=alert'), 'https://ch.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b')
        self.assertEqual(job_alerts.canonical('https://www.jobs.ch/en/vacancies/detail/abc/?utm=x'), 'https://www.jobs.ch/en/vacancies/detail/abc/')
        self.assertEqual(job_alerts.canonical('https://www.linkedin.com/jobs/alerts'), '')

    def test_a_failing_source_is_reported_and_the_others_go_on(self):
        class Broken(FakeGmail):
            def search(self, query, limit=50):
                if 'linkedin' in query:
                    raise OSError('Gmail down')
                return []
        report = job_alerts.scan(sqlite3.connect(':memory:'), Broken({}), FakeClient(ANSWER))
        self.assertEqual(report['sources'][0], {'company': 'LinkedIn alerts', 'ok': False, 'error': 'OSError: Gmail down'})
        self.assertEqual(len(report['sources']), len(job_alerts.SOURCES))


if __name__ == '__main__':
    unittest.main()

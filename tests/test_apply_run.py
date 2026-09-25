import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from src.ai import apply_run


URL = 'https://example.test/jobs/123'


def result(start, end):
    return {
        'status': 'ready', 'page_url': 'https://ats.example.test/apply/123', 'form_field_count': 1,
        'fields': [{'label': 'Email', 'source': 'CV', 'required': True,
                    'observed': True, 'matches_source': True}],
        'attachments': [{'label': 'Resume', 'present': True}], 'unanswered': [],
        'checks': {'submit_untouched': True, 'legal_acknowledgments_untouched': True,
                   'browser_form_inspected': True, 'guard_active': True},
        'fill_intervals': [{'start': start.isoformat(), 'end': end.isoformat()}],
        'summary': 'Ready for applicant review.'
    }


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.start = datetime.now(timezone.utc) - timedelta(minutes=10)
        self.end = self.start + timedelta(minutes=10)
        self.sample = result(self.start + timedelta(minutes=1), self.start + timedelta(minutes=3))

    def test_accepts_verified_form_and_active_time(self):
        self.assertEqual(apply_run.audit(self.sample, URL, self.start, self.end), ('ready', 2.0, ''))

    def test_rejects_missing_or_mismatched_evidence(self):
        for change in (
            lambda x: x['checks'].update(submit_untouched=False),
            lambda x: x['checks'].update(guard_active=False),
            lambda x: x['fields'][0].update(matches_source=False),
            lambda x: x.update(form_field_count=2),
            lambda x: x['attachments'][0].update(present=False),
            lambda x: x['unanswered'].append('Work authorization'),
            lambda x: x.update(fill_intervals=[]),
            lambda x: x.update(page_url='http://example.test/form'),
        ):
            sample = json.loads(json.dumps(self.sample))
            change(sample)
            self.assertEqual(apply_run.audit(sample, URL, self.start, self.end)[0], 'needs_user')

    def test_rejects_overlapping_or_out_of_run_time(self):
        sample = json.loads(json.dumps(self.sample))
        sample['fill_intervals'].append({'start': (self.start + timedelta(minutes=2)).isoformat(),
                                         'end': (self.start + timedelta(minutes=4)).isoformat()})
        self.assertEqual(apply_run.audit(sample, URL, self.start, self.end)[0], 'needs_user')

    def test_unanswered_eligibility_is_a_user_blocker(self):
        sample = {'status': 'failed', 'unanswered': ['Location eligibility requires owner review']}
        self.assertEqual(apply_run.audit(sample, URL, self.start, self.end),
                         ('needs_user', None,
                          'owner input needed: Location eligibility requires owner review'))
        sample['fill_intervals'] = [{'start': (self.start - timedelta(minutes=1)).isoformat(),
                                     'end': self.start.isoformat()}]
        self.assertEqual(apply_run.audit(sample, URL, self.start, self.end)[0], 'needs_user')


class FakeTracker:
    def __init__(self):
        self.marked = []
        self.updated = []

    def find(self, url):
        return {'id': 'page-1', 'properties': {'Stage': {'select': {'name': 'Saved'}}}}

    def mark(self, job, stage):
        self.marked.append(stage)

    def read_kit(self, page_id, heading):
        return {'url': URL, 'check_before_sending': []}

    def update_page(self, page_id, properties):
        self.updated.append(properties)


class RunnerTests(unittest.TestCase):
    def test_records_review_ready_result_outside_repo(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(apply_run, 'STATE_DIR', Path(directory)):
            tracker = FakeTracker()

            def fake_codex(command, **kwargs):
                self.assertIn('browser-submit-guard.js', ' '.join(command))
                self.assertIn('browser-form-fastpath.js', ' '.join(command))
                output = Path(command[command.index('--output-last-message') + 1])
                now = datetime.now(timezone.utc)
                output.write_text(json.dumps(result(now, now)))
                return type('Process', (), {'returncode': 0, 'stderr': ''})()

            with patch.object(apply_run.subprocess, 'run', side_effect=fake_codex):
                state = apply_run.run(URL, tracker)
            self.assertEqual(state['status'], 'ready')
            self.assertEqual(tracker.marked, ['Applying'])
            self.assertIn('Form fill time (min)', tracker.updated[0])
            self.assertTrue((Path(directory) / f'{apply_run.job_code(URL)}.json').exists())
            with self.assertRaises(RuntimeError):
                apply_run.run(URL, tracker)

    def test_eligibility_check_stops_before_codex(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(apply_run, 'STATE_DIR', Path(directory)):
            tracker = FakeTracker()
            tracker.read_kit = lambda page_id, heading: {
                'url': URL, 'check_before_sending': ['Confirm location eligibility']}
            with patch.object(apply_run.subprocess, 'run') as codex:
                state = apply_run.run(URL, tracker)
            self.assertEqual(state['status'], 'needs_user')
            self.assertIn('location eligibility', state['reason'])
            codex.assert_not_called()


if __name__ == '__main__':
    unittest.main()

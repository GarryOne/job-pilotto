import io
import json
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.notion import client as notion
from src.notion import ledger

URL = 'https://job-boards.greenhouse.io/acme/jobs/123'
NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
KIT = {'version': 1, 'model': 'claude-sonnet-5', 'cover_letter': 'Dear Acme,\n\nI run things.',
       'answers': [{'question': 'Why Acme?', 'answer': 'Drafted reason.', 'needs_review': False},
                   {'question': 'Notice period', 'answer': 'One month', 'needs_review': True}],
       'highlights': [], 'check_before_sending': []}


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def row(page_id='page-1', stage='Applied', applied='2026-09-20', posted='2026-09-15', recorded=None, edited=None):
    props = {'Job': {'type': 'title', 'title': [{'plain_text': 'Staff SRE'}]}, 'Company': text('Acme'),
             'Location': text('Zurich'), 'Job URL': {'type': 'url', 'url': URL},
             'Stage': {'type': 'select', 'select': {'name': stage}},
             'Applied on': {'type': 'date', 'date': {'start': applied} if applied else None},
             'Posted': {'type': 'date', 'date': {'start': posted} if posted else None},
             'Recorded': {'type': 'date', 'date': {'start': recorded} if recorded else None}}
    return {'id': page_id, 'properties': props, 'last_edited_time': edited or '2026-09-21T10:00:00.000Z'}


MATCH = {'properties': {'Score': {'type': 'number', 'number': 82},
                        'Tier': {'type': 'select', 'select': {'name': 'A'}},
                        'Seniority': {'type': 'select', 'select': {'name': 'Staff/Principal'}},
                        'Work mode': {'type': 'select', 'select': {'name': 'Hybrid'}},
                        'Recruiter': {'type': 'checkbox', 'checkbox': False},
                        'Job URL': {'type': 'url', 'url': URL}}}


class FakeTracker:
    database_id = 'apps'

    def __init__(self, rows, events=(), kit=KIT):
        self.rows, self.events, self.kit = list(rows), list(events), kit
        self.updates, self.created, self.sections, self.marked = [], [], [], []

    def find(self, url):
        return next((r for r in self.rows if r['properties']['Job URL']['url'] == url), None)

    def read_kit(self, page_id, heading):
        return self.kit

    def query_database(self, database_id, filter_=None):
        if database_id == ledger.EVENTS_DATABASE_ID:
            return self.events
        if database_id == notion.MATCHES_DATABASE_ID:
            return [MATCH]
        return self.rows

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))

    def create_page(self, database_id, properties):
        self.created.append((database_id, properties))
        return {'id': 'event'}

    def replace_section(self, page_id, heading, block):
        self.sections.append((page_id, heading, block))

    def mark(self, job, stage):
        self.marked.append((job['url'], stage))
        return self.rows[0], 'updated'


def event(page_id, kind, at):
    return {'properties': {'Kind': {'type': 'select', 'select': {'name': kind}},
                           'At': {'type': 'date', 'date': {'start': at}},
                           'Application': {'type': 'relation', 'relation': [{'id': page_id}]}}}


class BuildTests(unittest.TestCase):
    def test_kit_answers_when_no_form_snapshot(self):
        props, record = ledger.build(URL, row(), KIT, {'Score': 82, 'Tier': 'A',
                                     'Seniority': 'Staff/Principal', 'Work mode': 'Hybrid', 'Recruiter': False},
                                     {'description': 'Run the fleet.'}, None, {'agent': 'claude', 'minutes': 6},
                                     'cv.pdf · abc', NOW)
        self.assertEqual(props['Answers captured'], {'select': {'name': 'Kit draft'}})
        self.assertEqual(props['Fit score'], {'number': 82})
        self.assertEqual(props['Tier'], {'select': {'name': 'A'}})
        self.assertEqual(props['ATS'], {'select': {'name': 'Greenhouse'}})
        self.assertEqual(props['Agent'], {'select': {'name': 'Claude'}})
        self.assertEqual(props['Days to apply'], {'number': 5})
        self.assertEqual(props['Questions'], {'number': 2})
        self.assertTrue(props['Cover letter']['checkbox'])
        self.assertEqual(record['job']['description'], 'Run the fleet.')
        self.assertEqual(record['variant'], 'v1')
        self.assertEqual(record['answers'][0]['draft'], 'Drafted reason.')

    def test_form_snapshot_wins_and_keeps_the_draft_for_comparison(self):
        form = {'fields': [{'label': 'Why Acme?', 'value': 'My own words.', 'type': 'textarea', 'required': True},
                           {'label': 'LinkedIn', 'value': 'https://linkedin.example/me', 'type': 'text'}]}
        props, record = ledger.build(URL, row(), KIT, {}, None, form, None, '', NOW)
        self.assertEqual(props['Answers captured'], {'select': {'name': 'Form'}})
        why, linkedin = record['answers']
        self.assertEqual((why['answer'], why['draft']), ('My own words.', 'Drafted reason.'))
        self.assertIsNone(linkedin['draft'])
        self.assertNotIn('Agent', props)
        section = ledger.record_blocks(record)
        labels = json.dumps(section, ensure_ascii=False)
        self.assertIn('edited from draft', labels)
        self.assertIn(ledger.RECORD_HEADING, labels)

    def test_no_kit_and_no_form(self):
        props, record = ledger.build('https://example.test/jobs/9', row(posted=None), None, {}, None, None, None, '', NOW)
        self.assertEqual(props['Answers captured'], {'select': {'name': 'None'}})
        self.assertEqual(props['ATS'], {'select': {'name': 'Other'}})
        self.assertNotIn('Days to apply', props)
        self.assertEqual(record['answers'], [])
        ledger.record_blocks(record)  # renders without a cover letter or answers

    def test_large_record_stays_within_notion_limits(self):
        kit = dict(KIT, answers=[{'question': f'Q{i}', 'answer': 'x' * 3000} for i in range(60)])
        _, record = ledger.build(URL, row(), kit, {}, {'description': 'd' * 50_000}, None, None, '', NOW)
        section = ledger.record_blocks(record)
        children = section['heading_2']['children']
        self.assertLessEqual(len(children), 100)
        for child in children:
            rich = child[child['type']]['rich_text']
            self.assertLessEqual(len(rich), 100)
            self.assertTrue(all(len(r['text']['content']) <= 2000 for r in rich))
        payload = ''.join(r['text']['content'] for r in children[-1]['code']['rich_text'])
        self.assertEqual(len(json.loads(payload)['answers']), 60)  # still valid JSON, nothing cut mid-way


class RecordTests(unittest.TestCase):
    def test_record_reads_snapshot_and_run_files(self):
        with tempfile.TemporaryDirectory() as snaps, tempfile.TemporaryDirectory() as runs:
            code = notion.job_code(URL)
            Path(snaps, f'{code}.json').write_text(json.dumps(
                {'fields': [{'label': 'Why Acme?', 'value': 'Sent text', 'type': 'textarea'}]}))
            Path(runs, f'{code}.json').write_text(json.dumps({'agent': 'codex', 'minutes': 9}))
            tracker = FakeTracker([row()])
            _, outcome = ledger.record(tracker, URL, now=NOW, posting=lambda url: None, cv_path='/missing.pdf',
                                       snapshot_dir=snaps, run_dir=runs)
        self.assertEqual(outcome, 'recorded')
        props = tracker.updates[0][1]
        self.assertEqual(props['Agent'], {'select': {'name': 'Codex'}})
        self.assertEqual(props['Answers captured'], {'select': {'name': 'Form'}})
        self.assertEqual(tracker.sections[0][1], ledger.RECORD_HEADING)

    def test_existing_record_is_not_overwritten(self):
        tracker = FakeTracker([row(recorded='2026-09-20T10:00:00+00:00')])
        with tempfile.TemporaryDirectory() as empty:
            _, outcome = ledger.record(tracker, URL, now=NOW, posting=lambda url: None, snapshot_dir=empty)
        self.assertEqual(outcome, 'exists')
        self.assertEqual(tracker.updates, [])

    def test_kit_only_record_is_upgraded_once_the_form_is_known(self):
        kit_only = row(recorded='2026-09-20T10:00:00+00:00')
        kit_only['properties']['Answers captured'] = {'type': 'select', 'select': {'name': 'Kit draft'}}
        with tempfile.TemporaryDirectory() as snaps:
            Path(snaps, f'{notion.job_code(URL)}.json').write_text(json.dumps(
                {'fields': [{'label': 'Why Acme?', 'value': 'Sent text'}]}))
            tracker = FakeTracker([kit_only])
            _, outcome = ledger.record(tracker, URL, now=NOW, posting=lambda url: None, snapshot_dir=snaps)
        self.assertEqual(outcome, 'recorded')
        self.assertEqual(tracker.updates[0][1]['Answers captured'], {'select': {'name': 'Form'}})

    def test_mark_applied_logs_event_even_when_record_fails(self):
        tracker = FakeTracker([row()])
        tracker.read_kit = lambda *a: (_ for _ in ()).throw(RuntimeError('Notion down'))
        out = ledger.mark_applied(tracker, URL, 'Watcher')
        self.assertEqual(tracker.marked, [(URL, 'Applied')])
        kinds = [(p['Kind']['select']['name'], p['Source']['select']['name']) for _, p in tracker.created]
        self.assertEqual(kinds, [('Applied', 'Watcher')])
        self.assertIn('application record skipped: RuntimeError', out)

    def test_set_stage_rejects_non_outcomes(self):
        with self.assertRaises(ValueError):
            ledger.set_stage(FakeTracker([row()]), URL, 'Saved')


class BackfillTests(unittest.TestCase):
    def test_records_only_rows_without_a_record(self):
        other = row(page_id='page-2', recorded='2026-09-20T10:00:00+00:00')
        other['properties']['Job URL'] = {'type': 'url', 'url': 'https://example.test/other'}
        tracker = FakeTracker([row(), other])
        with tempfile.TemporaryDirectory() as empty:
            lines = ledger.backfill(tracker, posting=lambda url: None, snapshot_dir=empty, run_dir=empty)
        self.assertEqual(lines, ['Acme — Staff SRE: recorded'])
        self.assertEqual([page for page, _ in tracker.updates], ['page-1'])


class AddApplicationTests(unittest.TestCase):
    def test_parse_applied(self):
        today = date(2026, 9, 26)
        self.assertEqual(ledger.parse_applied('on or before 23 Sep', today), (date(2026, 9, 23), True))
        self.assertEqual(ledger.parse_applied('2026-09-23', today), (date(2026, 9, 23), False))
        self.assertEqual(ledger.parse_applied('Sep 2', today), (date(2026, 9, 2), False))
        self.assertEqual(ledger.parse_applied('30 Dec', today), (date(2025, 12, 30), False))  # never in the future
        self.assertEqual(ledger.parse_applied('', today), (None, False))
        with self.assertRaises(ValueError):
            ledger.parse_applied('last week', today)

    def test_channel_for(self):
        self.assertEqual(ledger.channel_for('https://jobs.techtree.dev/job/1'), ('Recruiter platform', 'TechTree'))
        self.assertEqual(ledger.channel_for(URL, {'Recruiter': True}), ('Agency', ''))
        self.assertEqual(ledger.channel_for(URL, {}), ('Direct', ''))

    def test_page_meta_reads_schema_org_job_posting(self):
        page = """<html><title>x</title><script type="application/ld+json">{"@type": "JobPosting",
            "title": "Infrastructure Engineer", "datePosted": "2026-07-20T09:24:45",
            "hiringOrganization": {"@type": "Organization", "name": "Robotics Co"},
            "jobLocation": {"@type": "Place", "address": "Zürich, Switzerland"},
            "description": "<p>Build &amp; run the edge platform</p>"}</script></html>"""
        with mock.patch.object(ledger.ats, 'posting', lambda url: None):
            meta = ledger.page_meta('https://jobs.techtree.dev/job/1', opener=lambda req, timeout: io.BytesIO(page.encode()))
        self.assertEqual((meta['title'], meta['company'], meta['location']),
                         ('Infrastructure Engineer', 'Robotics Co', 'Zürich, Switzerland'))
        self.assertIn('Build & run', meta['description'])

    def test_new_application_row_event_on_its_date_and_record(self):
        tracker = FakeTracker([])
        meta = {'title': 'Infrastructure Engineer', 'company': 'Robotics Co', 'location': 'Zürich', 'date_posted': '2026-07-20'}
        def create(database_id, properties):
            tracker.created.append((database_id, properties))
            if database_id == 'apps':
                tracker.rows.append({'id': 'new', 'properties': {
                    'Job': {'type': 'title', 'title': [{'plain_text': 'Infrastructure Engineer'}]},
                    'Company': text('Robotics Co'), 'Job URL': {'type': 'url', 'url': 'https://jobs.techtree.dev/job/1'},
                    'Stage': {'type': 'select', 'select': {'name': 'Applied'}},
                    'Applied on': {'type': 'date', 'date': {'start': '2026-09-23'}}}})
            return {'id': 'x'}
        tracker.create_page = create
        with tempfile.TemporaryDirectory() as empty, mock.patch.multiple(ledger, SNAPSHOT_DIR=Path(empty), RUN_DIR=Path(empty)):
            line = ledger.add_application(tracker, 'https://jobs.techtree.dev/job/1', applied=date(2026, 9, 23),
                                          approx=True, meta=meta, source='Telegram')
        row_props = tracker.created[0][1]
        self.assertEqual(row_props['Channel'], {'select': {'name': 'Recruiter platform'}})
        self.assertEqual(row_props['Via']['rich_text'][0]['text']['content'], 'TechTree')
        self.assertTrue(row_props['Date approximate']['checkbox'])
        self.assertEqual(row_props['Posted'], {'date': {'start': '2026-07-20'}})
        event = tracker.created[1][1]
        self.assertEqual((event['Kind']['select']['name'], event['At']['date']['start']), ('Applied', '2026-09-23'))
        self.assertIn('on or before 2026-09-23', line)
        self.assertIn('via TechTree', line)

    def test_company_falls_back_to_the_board_slug(self):
        tracker2 = FakeTracker([])  # its Job Matches row (MATCH) has no Company either
        tracker2.find = lambda url: None
        tracker2.create_page = lambda db, props: tracker2.created.append(props) or {'id': 'n', 'properties': props}
        ledger.add_application(tracker2, URL, meta={'title': 'SRE'})
        self.assertEqual(tracker2.created[0]['Company']['rich_text'][0]['text']['content'], 'Acme')

    def test_later_stage_is_left_alone(self):
        tracker = FakeTracker([row(stage='Screening')])
        self.assertIn('Already tracked at Screening', ledger.add_application(tracker, URL, meta={}))
        self.assertEqual(tracker.updates, [])

    def test_applied_event_defaults_to_the_applied_on_date(self):
        tracker = FakeTracker([row()])
        ledger.add_event(tracker, row(applied='2026-09-20'), 'Applied', 'CLI')
        self.assertEqual(tracker.created[0][1]['At'], {'date': {'start': '2026-09-20'}})

    def test_record_sets_channel_only_when_empty(self):
        props, _ = ledger.build('https://jobs.techtree.dev/job/1', row(), None, {}, None, None, None, '', NOW)
        self.assertEqual(props['Channel'], {'select': {'name': 'Recruiter platform'}})
        owned = row()
        owned['properties']['Channel'] = {'type': 'select', 'select': {'name': 'Referral'}}
        props, _ = ledger.build('https://jobs.techtree.dev/job/1', owned, None, {}, None, None, None, '', NOW)
        self.assertNotIn('Channel', props)


class SyncTests(unittest.TestCase):
    def kinds(self, tracker):
        return [(p['Kind']['select']['name'], p['Source']['select']['name']) for _, p in tracker.created]

    def test_hand_edited_stage_becomes_an_event(self):
        tracker = FakeTracker([row(stage='Screening')], [event('page-1', 'Applied', '2026-09-20')])
        summary = ledger.sync(tracker, now=NOW)
        self.assertEqual(self.kinds(tracker), [('Screening', 'Notion edit')])
        self.assertIn('1 stage change(s) logged', summary)

    def test_in_sync_rows_are_left_alone(self):
        tracker = FakeTracker([row()], [event('page1', 'Applied', '2026-09-20')])  # ids compared without dashes
        ledger.sync(tracker, now=NOW)
        self.assertEqual(tracker.created, [])

    def test_no_reply_after_30_days_moves_to_no_response(self):
        tracker = FakeTracker([row(applied='2026-08-20')], [event('page-1', 'Applied', '2026-08-20')])
        summary = ledger.sync(tracker, now=NOW)
        self.assertEqual(tracker.updates, [('page-1', {'Stage': {'select': {'name': 'No response'}}})])
        self.assertEqual(self.kinds(tracker), [('No response', 'Auto rule')])
        self.assertIn('1 moved to No response', summary)

    def test_recent_reply_resets_the_clock_and_later_stages_never_expire(self):
        confirmed = FakeTracker([row(stage='Confirmation received', applied='2026-08-01')],
                                [event('page-1', 'Confirmation received', '2026-09-10')])
        screening = FakeTracker([row(stage='Screening', applied='2026-07-01')],
                                [event('page-1', 'Screening', '2026-07-05')])
        ledger.sync(confirmed, now=NOW)
        ledger.sync(screening, now=NOW)
        self.assertEqual(confirmed.updates + screening.updates, [])

    def test_backfilled_old_application_gets_event_then_no_response(self):
        tracker = FakeTracker([row(applied='2026-08-01')])
        ledger.sync(tracker, now=NOW)
        self.assertEqual(self.kinds(tracker), [('Applied', 'Backfill'), ('No response', 'Auto rule')])

    def test_reply_is_not_a_stage_change_and_stops_the_no_response_rule(self):
        tracker = FakeTracker([row(applied='2026-08-01')], [event('page-1', 'Applied', '2026-08-01'),
                                                            event('page-1', 'Reply received', '2026-08-03')])
        self.assertIn('0 stage change(s) logged, 0 moved', ledger.sync(tracker, now=NOW))
        self.assertEqual((tracker.created, tracker.updates), ([], []))

    def test_dry_run_writes_nothing(self):
        tracker = FakeTracker([row(applied='2026-08-01')])
        self.assertIn('1 moved', ledger.sync(tracker, now=NOW, dry_run=True))
        self.assertEqual((tracker.created, tracker.updates), ([], []))


if __name__ == '__main__':
    unittest.main()

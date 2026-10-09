"""The Job Tracker's Origin column (src/notion/origin.py): every path that creates an Applications row sets it once
(recruiter contact = Inbound, a job you went after = Outbound), an Origin already there is never overwritten, the
readers take it before the derived rule, and the one-time backfill fills only empty rows."""
import unittest
from datetime import date
from unittest import mock

from src.ai import inbox, inbox_notion, mail, mail_leads, opportunity
from src.notion import client, funnel, ledger, origin
from tests.mail_fakes import FakeTracker, stores_for


def select(name):
    return {'type': 'select', 'select': {'name': name} if name else None}


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}] if value else []}


def app_row(page_id, *, stage='Applied', source='', notes='', origin_value=None, job='Role'):
    return {'id': page_id, 'url': '', 'properties': {
        'Job': {'type': 'title', 'title': [{'plain_text': job}]}, 'Job URL': {'type': 'url', 'url': f'https://x/{page_id}'},
        'Stage': select(stage), 'Source': select(source), 'Notes': text(notes), 'Origin': select(origin_value)}}


class Fake:
    """Enough of client.Tracker for the creating paths: rows created are remembered, nothing exists yet."""
    database_id = 'apps'

    def __init__(self, rows=(), events=()):
        self.rows, self.events, self.created, self.updates = list(rows), list(events), [], []

    def find(self, url):
        return next((r for r in self.rows if r['properties']['Job URL']['url'] == url), None)

    def query_database(self, database_id, filter_=None):
        return self.events if database_id == ledger.EVENTS_DATABASE_ID and database_id else self.rows

    def create_page(self, database_id, properties):
        self.created.append((database_id, properties))
        return {'id': f'new{len(self.created)}', 'url': '', 'properties': {}}

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))
        row = next((r for r in self.rows if r['id'] == page_id), None)
        if row:
            row['properties'].update({k: {'type': next(iter(v)), **v} for k, v in properties.items()})

    def replace_after_heading(self, *args):
        pass

    def app_props(self):
        return [props for db, props in self.created if db == 'apps']


def origin_of(props):
    return ((props.get('Origin') or {}).get('select') or {}).get('name')


class StampTests(unittest.TestCase):
    def test_an_explicit_value_wins_and_an_existing_origin_is_kept(self):
        self.assertEqual(origin_of(origin.stamp({}, origin.INBOUND)), 'Inbound')
        kept = origin.stamp({'Origin': {'select': {'name': 'Outbound'}}}, origin.INBOUND)
        self.assertEqual(origin_of(kept), 'Outbound')

    def test_without_a_value_the_row_as_created_decides(self):
        lead = {'Stage': {'select': {'name': 'Recruiter lead'}}, 'Source': {'select': {'name': 'Gmail'}}}
        self.assertEqual(origin_of(origin.stamp(lead)), 'Inbound')
        pasted = {'Source': {'select': {'name': 'LinkedIn'}},
                  'Notes': {'rich_text': [{'text': {'content': 'Logged from a paste (LinkedIn)'}}]}}
        self.assertEqual(origin_of(origin.stamp(pasted)), 'Outbound')


class WriterTests(unittest.TestCase):
    def test_saved_kit_applying_applied_rows_are_outbound(self):
        for stage in ('Saved', 'Kit ready', 'Applying', 'Applied', 'Dismissed'):
            tracker, sent = client.Tracker('t', 'apps'), []
            tracker.find = lambda url: None
            tracker._request = lambda method, path, body=None: sent.append(body) or {'id': 'p'}
            tracker.mark({'url': 'https://x/job', 'title': 'SRE'}, stage)
            self.assertEqual(origin_of(sent[0]['properties']), 'Outbound', stage)

    def test_mark_on_an_existing_row_never_writes_origin(self):
        tracker, sent = client.Tracker('t', 'apps'), []
        tracker.find = lambda url: app_row('r1', stage='Saved', origin_value='Inbound')
        tracker._request = lambda method, path, body=None: sent.append(body) or {}
        tracker.mark({'url': 'https://x/r1', 'title': 'SRE'}, 'Applied')
        self.assertNotIn('Origin', sent[0]['properties'])

    def test_applied_elsewhere_is_outbound_unless_the_first_contact_found_you(self):
        with mock.patch.object(ledger, 'add_event'), mock.patch.object(ledger, 'record', return_value=(None, 'ok')):
            tracker = Fake()
            ledger.add_application(tracker, 'https://x/a', meta={'title': 'SRE', 'company': 'Acme'}, today=date(2026, 9, 30))
            self.assertEqual(origin_of(tracker.app_props()[0]), 'Outbound')
            tracker = Fake()
            ledger.add_application(tracker, 'https://x/b', meta={'title': 'SRE', 'company': 'Acme'}, origin=origin.INBOUND)
            self.assertEqual(origin_of(tracker.app_props()[0]), 'Inbound')

    def test_applied_elsewhere_on_an_existing_row_leaves_its_origin(self):
        tracker = Fake([app_row('r1', stage='Saved', origin_value='Inbound')])
        with mock.patch.object(ledger, 'add_event'), mock.patch.object(ledger, 'record', return_value=(None, 'ok')):
            ledger.add_application(tracker, 'https://x/r1', meta={'title': 'SRE', 'company': 'Acme'})
        self.assertTrue(tracker.updates)
        self.assertTrue(all('Origin' not in props for _, props in tracker.updates))
        self.assertEqual(tracker.app_props(), [])

    def test_logging_a_first_contact_on_linkedin_for_an_open_job_is_inbound(self):
        # "Log job activity": a reply on LinkedIn you said was the first contact, about a job not tracked yet.
        for first_here, expected in ((True, origin.INBOUND), (False, None)):
            seen = {}
            def add(tracker, url, **kwargs):
                seen.update(kwargs)
                raise StopIteration  # the rest of the log isn't this test's business
            proposal = {'item': {'platform': 'LinkedIn', 'first_contact_here': first_here, 'title': 'SRE'},
                        'job': {'url': 'https://x/open', 'title': 'SRE', 'company': 'Acme'}, 'kind': inbox.REPLY,
                        'confirmed': True}
            with mock.patch.object(inbox.ledger, 'add_application', add), mock.patch.object(inbox, 'step', create=True):
                with self.assertRaises(StopIteration):
                    inbox.log(Fake(), text='Thanks, let us talk', proposal=proposal, source='Job Pilotto app')
            self.assertEqual(seen['origin'], expected)

    def test_a_recruiter_lead_is_inbound(self):
        tracker = FakeTracker([])
        lead = {'title': 'Platform Engineer', 'company': 'Beta', 'platform': 'Email', 'recruiter_company': 'Huxley'}
        row, _ = opportunity.track(stores_for(tracker), lead, 'Hi, a role for you', source='Gmail', event_source='Gmail',
                                   url='https://x/lead')
        self.assertIsNotNone(row)
        self.assertEqual(origin_of(tracker.created[0]), 'Inbound')

    def test_a_pasted_application_made_elsewhere_is_outbound_even_from_linkedin(self):
        tracker = Fake()
        item = {'title': 'SRE', 'company': 'Acme', 'platform': 'LinkedIn'}
        with mock.patch.object(inbox_notion, 'add_event'):
            inbox._new_row(tracker, item, 'https://x/pasted', 'LinkedIn', 'App', '2026-09-20', 'logged')
        self.assertEqual(origin_of(tracker.app_props()[0]), 'Outbound')

    def test_an_email_about_an_untracked_role_writes_no_application(self):
        tracker = Fake()   # asked in Focus instead (src/ai/mail.py run); a new job chosen there is made by src/ai/reassign.py
        email = {'date': '2026-09-20T10:00:00Z', 'id': 'm1', 'subject': 'Thanks for applying', 'body': ''}
        with mock.patch.object(mail_leads.rules, 'add_event'):
            self.assertIsNone(mail._from_email(stores_for(tracker), [], {'company': 'Acme', 'role': 'SRE'}, email, None, []))
        self.assertEqual(tracker.app_props(), [])


class ReaderTests(unittest.TestCase):
    def test_the_column_wins_over_the_derived_rule(self):
        lead = app_row('r1', stage='Recruiter lead', source='LinkedIn', notes='Recruiter message (LinkedIn)', origin_value='Outbound')
        self.assertEqual(funnel.row_origin(lead, ['Recruiter lead']), 'outbound')
        applied = app_row('r2', stage='Screening', origin_value='Inbound')
        self.assertEqual(funnel.row_origin(applied, ['Applied', 'Recruiter lead']), 'inbound')

    def test_an_empty_column_falls_back(self):
        self.assertEqual(funnel.row_origin(app_row('r1', stage='Recruiter lead')), 'inbound')
        self.assertEqual(funnel.row_origin(app_row('r2', stage='Applied', source='Gmail')), 'outbound')
        self.assertEqual(origin.row_origin({'properties': {'Stage': select('Saved')}}), 'outbound')  # no column yet

    def test_the_jobs_list_carries_the_column(self):
        page = {**app_row('a1', stage='Screening', source='Gmail', origin_value='Inbound'), 'created_time': '2026-09-29'}
        tracker = client.Tracker('t', 'apps')
        with mock.patch.object(client, 'MATCHES_DATABASE_ID', ''), mock.patch.object(tracker, '_query', return_value=[page]):
            jobs = tracker.notion_jobs()
        self.assertEqual(jobs[0]['origin'], 'Inbound')


class BackfillTests(unittest.TestCase):
    def workspace(self):
        rows = [app_row('lead', stage='Recruiter lead', source='Gmail'),                         # derived Inbound
                app_row('applied', stage='Applied', source='Job Pilotto app'),                   # derived Outbound
                app_row('answered', stage='Screening', source='Job Pilotto app'),                # Applied first: Outbound
                app_row('mine', stage='Recruiter lead', source='LinkedIn', origin_value='Outbound')]  # set by hand: kept
        at = lambda kind, when, app: {'properties': {'Kind': select(kind), 'At': {'date': {'start': when}},
                                                     'Application': {'relation': [{'id': app}]}}}
        events = [at('Recruiter lead', '2026-09-10', 'answered'), at('Applied', '2026-09-01', 'answered')]
        return Fake(rows, events)

    def test_dry_run_lists_and_writes_nothing(self):
        tracker = self.workspace()
        with mock.patch.object(ledger, 'EVENTS_DATABASE_ID', 'events'):
            result = origin.backfill(tracker)
        self.assertEqual((result['set'], result['kept']), ({'inbound': 1, 'outbound': 2}, 1))
        self.assertEqual(tracker.updates, [])
        self.assertIn('Would set Origin on 3 row(s): 1 Inbound, 2 Outbound; 1 already had one.', result['lines'][-1])

    def test_apply_fills_only_empty_rows_and_a_second_run_changes_nothing(self):
        tracker = self.workspace()
        with mock.patch.object(ledger, 'EVENTS_DATABASE_ID', 'events'):
            origin.backfill(tracker, apply=True)
            written = {page: origin_of(props) for page, props in tracker.updates}
            self.assertEqual(written, {'lead': 'Inbound', 'applied': 'Outbound', 'answered': 'Outbound'})
            again = origin.backfill(tracker, apply=True)
        self.assertEqual((again['set'], again['kept']), ({'inbound': 0, 'outbound': 0}, 4))
        self.assertEqual(len(tracker.updates), 3)

    def test_without_the_column_it_stops_before_writing(self):
        row = app_row('r1')
        del row['properties']['Origin']
        with self.assertRaises(SystemExit):
            origin.backfill(Fake([row]), apply=True)

    def test_the_cli_is_a_dry_run_by_default(self):
        tracker = self.workspace()
        with mock.patch.object(client.Tracker, 'from_env', return_value=tracker), \
                mock.patch.object(origin, 'backfill', wraps=origin.backfill) as run, mock.patch('builtins.print'):
            self.assertEqual(origin.main(['--backfill']), 0)
        self.assertFalse(run.call_args.kwargs['apply'])
        self.assertEqual(tracker.updates, [])


if __name__ == '__main__':
    unittest.main()

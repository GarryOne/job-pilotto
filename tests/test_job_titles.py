"""An inbound job's title names who it is for ("Principal SRE · via Huxley", src/notion/titles.py): created that way,
updated once the employer is known (never over a title you edited), outbound rows untouched, and every place that
matches by role or shows the employer / agency on its own line reads the role alone."""
import unittest
from unittest import mock

from src import focus
from src.ai import inbox, interviews, mail, opportunity
from src.notion import client, ledger, origin, titles
from src.notion.titles import job_title, role_of


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}] if value else []}


def select(value):
    return {'type': 'select', 'select': {'name': value} if value else None}


def row(job, company='', via='', origin_value='Inbound', stage='Screening', **extra):
    return {'id': 'r1', 'url': 'https://notion.test/r1', 'properties': {
        'Job': {'type': 'title', 'title': [{'plain_text': job}]}, 'Company': text(company), 'Via': text(via),
        'Origin': select(origin_value), 'Stage': select(stage), 'Job URL': {'type': 'url', 'url': 'https://x/r1'},
        **extra}}


# (role, company, via) -> title
TABLE = [
    (('Principal SRE', '', 'Huxley'), 'Principal SRE · via Huxley'),              # agency only
    (('Principal SRE', 'Acme', ''), 'Principal SRE · Acme'),                      # employer only
    (('Principal SRE', 'Acme', 'Huxley'), 'Principal SRE · Acme'),                # both: the employer wins
    (('Principal SRE', '', ''), 'Principal SRE'),                                 # neither
    (('Principal SRE', '(unnamed fintech client)', 'Huxley'), 'Principal SRE · via Huxley'),  # placeholder employer
    (('Principal SRE', 'Unknown', ''), 'Principal SRE'),
    (('Principal SRE', 'N/A', 'not named'), 'Principal SRE'),
    (('Principal SRE', 'x' * 61, 'Huxley'), 'Principal SRE · via Huxley'),        # too long to be a name
    (('Principal SRE · via Huxley', '', 'Huxley'), 'Principal SRE · via Huxley'), # idempotent
    (('Principal SRE · via Huxley', 'Acme', 'Huxley'), 'Principal SRE · Acme'),   # the employer, once known
    (('SRE at Huxley', '', 'Huxley'), 'SRE at Huxley'),                           # already names it
    (('', 'Acme', ''), ''),
]


class JobTitleTests(unittest.TestCase):
    def test_the_table(self):
        for args, expected in TABLE:
            with self.subTest(args=args):
                self.assertEqual(job_title(*args), expected)
                self.assertEqual(job_title(expected, *args[1:]), expected)  # idempotent

    def test_a_long_role_is_shortened_never_the_employer(self):
        long_role = 'Principal Site Reliability Engineer, Cloud Platform, Observability and Developer Experience Group'
        title = job_title(long_role, 'Acme Industries', '')
        self.assertTrue(title.endswith('… · Acme Industries'), title)
        self.assertLessEqual(len(title), titles.MAX_TITLE)
        self.assertEqual(job_title(title, 'Acme Industries', ''), title)

    def test_role_of_is_the_inverse(self):
        self.assertEqual(role_of('Principal SRE · via Huxley', '', 'Huxley'), 'Principal SRE')
        self.assertEqual(role_of('Principal SRE · Acme', 'Acme', 'Huxley'), 'Principal SRE')
        self.assertEqual(role_of('Principal SRE · via Huxley', 'Acme', 'Huxley'), 'Principal SRE')  # before Acme was known
        self.assertEqual(role_of('Principal SRE', 'Acme', 'Huxley'), 'Principal SRE')
        self.assertEqual(role_of('Principal SRE · Zurich', 'Acme', ''), 'Principal SRE · Zurich')  # not ours
        self.assertEqual(role_of('Acme', 'Acme', ''), 'Acme')  # a role is never stripped to nothing

    def test_named_is_the_interview_title_rule(self):
        self.assertIs(interviews.named, titles.named)

    def test_retitled_updates_generated_titles_only(self):
        self.assertEqual(titles.retitled('Principal SRE', '', 'Huxley'), 'Principal SRE · via Huxley')
        self.assertEqual(titles.retitled('Principal SRE · via Huxley', 'Acme', 'Huxley', was=('', 'Huxley')), 'Principal SRE · Acme')
        self.assertEqual(titles.retitled('SRE · via Huxley', '', 'Huxley', role='Principal SRE'), 'Principal SRE · via Huxley')
        self.assertEqual(titles.retitled('Principal SRE · via Huxley', '', 'Huxley'), '')  # nothing new
        self.assertEqual(titles.retitled('Principal SRE · Zurich team', 'Acme', 'Huxley'), '')  # you edited it
        self.assertEqual(titles.retitled('SRE at Huxley', '', 'Huxley'), '')
        self.assertEqual(titles.retitled('Principal SRE', '', ''), '')


class CreatedTests(unittest.TestCase):
    def props(self, job, company='', via=''):
        return {'Job': {'title': [{'text': {'content': job}}]}, 'Company': {'rich_text': [{'text': {'content': company}}]},
                'Via': {'rich_text': [{'text': {'content': via}}]}}

    def test_an_inbound_row_is_created_with_the_suffix_an_outbound_one_without(self):
        stamped = origin.stamp(self.props('Principal SRE', '', 'Huxley'), origin.INBOUND)
        self.assertEqual(titles.text_value(stamped['Job']), 'Principal SRE · via Huxley')
        stamped = origin.stamp(self.props('Principal SRE', 'Acme', 'Huxley'), origin.OUTBOUND)
        self.assertEqual(titles.text_value(stamped['Job']), 'Principal SRE')
        stamped = origin.stamp({**self.props('Principal SRE', 'Acme'), 'Origin': {'select': {'name': 'Inbound'}}})
        self.assertEqual(titles.text_value(stamped['Job']), 'Principal SRE · Acme')

    def test_a_recruiter_lead_gets_the_agency_and_a_second_pitch_still_finds_it(self):
        lead = {'title': 'Principal SRE', 'company': '', 'recruiter_company': 'Huxley', 'recruiter_name': 'Jayantie Nejati',
                'recruiter_email': 'j.nejati@huxley.test', 'platform': 'Email', 'in_house': False}
        tracker = LeadTracker()
        created, _ = opportunity.track(tracker, lead, 'Hi Igor, a Principal SRE role…', source='Gmail', event_source='Gmail',
                                       gmail_id='m1')
        props = tracker.created[0]
        self.assertEqual(titles.text_value(props['Job']), 'Principal SRE · via Huxley')
        self.assertEqual(ledger.plain(created['properties']['Job']), 'Principal SRE · via Huxley')
        # The same pitch again (pasted in the app): matched by role and agency, not by the suffixed title.
        tracker.rows = [row('Principal SRE · via Huxley', via='Huxley', stage='Recruiter lead',
                            Contact=text('Jayantie Nejati · j.nejati@huxley.test'))]
        self.assertIsNotNone(opportunity.same_pitch(tracker, lead))

    def test_an_email_about_an_untracked_role_creates_no_job(self):
        # Asked in Focus instead (src/ai/mail.py run): a job made from an email alone had a Gmail link for its posting and nothing else.
        tracker = LeadTracker()
        email = {'id': 'e1', 'date': '2026-09-20T10:00:00+00:00', 'subject': 'Thanks for applying', 'body': ''}
        self.assertIsNone(mail._from_email(tracker, [], {'company': 'Acme', 'role': 'Principal SRE'}, email, None, []))
        self.assertEqual(tracker.created, [])


class LeadTracker:
    database_id = 'apps'

    def __init__(self):
        self.created, self.updates, self.rows = [], [], []

    def find(self, url):
        return None

    def query_database(self, database_id, filter_=None):
        return self.rows

    def create_page(self, database_id, properties):
        self.created.append(properties)
        return {'id': f'new{len(self.created)}', 'url': '', 'properties': {}}

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))

    def replace_after_heading(self, *args):
        pass


class Updates:
    def __init__(self):
        self.updates = []

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))


class LaterUpdateTests(unittest.TestCase):
    def test_the_employer_learned_later_replaces_the_agency_in_the_title(self):
        tracker, job = Updates(), row('Principal SRE · via Huxley', via='Huxley')
        inbox._fill_gaps(tracker, job, {'company': 'Acme'})
        self.assertEqual(ledger.plain(job['properties']['Job']), 'Principal SRE · Acme')
        self.assertEqual(ledger.plain(job['properties']['Company']), 'Acme')

    def test_a_bare_inbound_title_gets_the_suffix_with_the_fuller_role(self):
        tracker, job = Updates(), row('SRE', via='Huxley')
        filled = inbox._fill_gaps(tracker, job, {'role': 'Principal SRE'})
        self.assertEqual(ledger.plain(job['properties']['Job']), 'Principal SRE · via Huxley')
        self.assertEqual(filled, ['the title "Principal SRE"'])

    def test_a_title_you_edited_is_never_replaced(self):
        tracker, job = Updates(), row('Principal SRE · Zurich team', via='Huxley')
        inbox._fill_gaps(tracker, job, {'company': 'Acme'})
        self.assertEqual(ledger.plain(job['properties']['Job']), 'Principal SRE · Zurich team')
        self.assertNotIn('Job', tracker.updates[0][1])

    def test_an_outbound_title_stays_the_role(self):
        tracker, job = Updates(), row('Principal SRE', origin_value='Outbound', stage='Applied')
        inbox._fill_gaps(tracker, job, {'company': 'Acme'})
        self.assertEqual(ledger.plain(job['properties']['Job']), 'Principal SRE')


class MatchingTests(unittest.TestCase):
    """Job URL is the key; where a role is compared, it is the role without the suffix."""

    def test_an_email_about_the_role_finds_the_suffixed_row(self):
        apps = [row('Principal SRE · Acme', company='Acme')]
        found = mail._from_email(LeadTracker(), apps, {'company': 'Acme', 'role': 'Principal SRE'},
                                 {'id': 'e', 'date': '', 'subject': '', 'body': ''}, None, [])
        self.assertIs(found, apps[0])

    def test_the_agency_name_is_not_a_role_word(self):
        mine = row('Principal SRE · via Huxley', via='Huxley')
        other = {**row('Platform Engineer · via Huxley', via='Huxley'), 'id': 'r2'}
        # An email from Huxley naming only "Huxley": which role is still a guess.
        self.assertTrue(mail._ambiguous([mine, other], mine, {'subject': 'Huxley: next steps', 'body': 'Hi from Huxley'}))

    def test_the_log_box_finds_the_job_by_role_and_agency(self):
        jobs = [{'title': role_of('Principal SRE · via Huxley', '', 'Huxley'), 'company': '', 'via': 'Huxley',
                 'contact': '', 'stage': 'Screening'}]
        self.assertEqual(inbox.same_job(jobs, {'role': 'Principal SRE', 'recruiter_company': 'Huxley'}), 0)


class DisplayTests(unittest.TestCase):
    """Places that show the employer or agency on their own line show the role alone."""

    def test_the_jobs_list_gets_the_role_and_the_agency_apart(self):
        tracker = client.Tracker.__new__(client.Tracker)
        page = {'id': 'r1', 'url': 'https://notion.test/r1', 'created_time': '2026-09-29T10:00:00Z',
                'properties': {**row('Principal SRE · via Huxley', via='Huxley')['properties'],
                               'Job URL': {'url': 'https://mail.google.com/mail/u/0/#all/m1'}}}
        with mock.patch.object(client, 'MATCHES_DATABASE_ID', ''), mock.patch.object(tracker, '_query', create=True,
                                                                                    return_value=[page]):
            job, = tracker.notion_jobs()
        self.assertEqual((job['title'], job['via']), ('Principal SRE', 'Huxley'))  # In conversation: role, then "via Huxley"

    def test_focus_items_and_labels(self):
        from tests.test_focus import from_notion
        job = from_notion(row('Principal SRE · via Huxley', via='Huxley'))
        item = focus.present(focus._item(1, 'reply', '💬', 'Reply', '', job, lead=True))
        self.assertEqual((item['job'], item['via']), ('Principal SRE', 'Huxley'))
        self.assertEqual((item['headline'], item['meta']), ('Reply to Huxley recruiter', ['Principal SRE']))
        event = {'id': 'e1', 'properties': {'Needs you': {'checkbox': True}, 'Application': {'relation': []},
                                            'Suggested job': {'url': 'https://x/r1'}, 'Note': text('Hi'), 'Kind': select('Reply')}}
        asked, = focus.questions([job], [from_notion(event, 'events')])
        self.assertEqual(asked['suggested_label'], 'Huxley — Principal SRE')

    def test_mail_lines_and_interview_pages(self):
        job = row('Principal SRE · via Huxley', via='Huxley')
        self.assertEqual(mail._label(job), 'Huxley — Principal SRE')
        line = interviews.job_line(job)['paragraph']['rich_text'][1]['text']['content']
        self.assertEqual(line, 'Huxley · Principal SRE')
        record = {'id': 'a', 'title': 'Principal SRE · via Huxley', 'company': '', 'via': 'Huxley'}  # the store's application record
        self.assertEqual(interviews.interview_title('', 'Screening', record), 'Huxley · Screening')


if __name__ == '__main__':
    unittest.main()

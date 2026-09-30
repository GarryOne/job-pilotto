import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import focus

NOW = datetime(2026, 9, 28, 15, 0, tzinfo=timezone.utc)  # Monday 17:00 in Zurich


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def row(page_id, company, job, stage='Applied', applied='2026-09-26', interview=None, **extra):
    props = {'Company': text(company), 'Job': {'type': 'title', 'title': [{'plain_text': job}]},
             'Stage': {'type': 'select', 'select': {'name': stage}}, 'Applied on': {'type': 'date', 'date': {'start': applied} if applied else None},
             'Next interview': {'type': 'date', 'date': {'start': interview} if interview else None},
             'Job URL': {'type': 'url', 'url': f'https://x.test/{page_id}'}}
    for name, value in extra.items():
        props[name.replace('_', ' ')] = text(value) if isinstance(value, str) else value
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'last_edited_time': '2026-09-28T14:00:00Z', 'properties': props}


def event(page_id, kind, at, note='', source_id=''):
    return {'properties': {'Kind': {'type': 'select', 'select': {'name': kind}}, 'At': {'type': 'date', 'date': {'start': at}},
                           'Note': text(note), 'Source ID': text(source_id),
                           'Application': {'type': 'relation', 'relation': [{'id': page_id}]}}}


class FocusTests(unittest.TestCase):
    def test_applications_per_day_for_the_chart_count_each_application_once_a_day(self):
        # The Applied on date or an Applied event that day; one application with both counts once.
        rows = [row('a', 'A', 'SRE', applied='2026-09-28'), row('b', 'B', 'SRE', applied='2026-09-26'),
                row('c', 'C', 'SRE', applied='2026-09-10'), row('d', 'D', 'SRE', stage='Kit ready', applied=None)]
        events = [event('a', 'Applied', '2026-09-28T09:00:00Z'), event('d', 'Applied', '2026-09-28T13:00:00Z')]
        today = focus.build(rows, events, target=5, now=NOW)['today']
        self.assertEqual(len(today['history']), 14)
        self.assertEqual(today['history'][-1], {'day': '2026-09-28', 'applied': 2})
        self.assertEqual(today['history'][-3], {'day': '2026-09-26', 'applied': 1})
        self.assertEqual(today['history'][0]['day'], '2026-09-15')  # 10 Sep is older than 14 days: not shown
        self.assertEqual(today['applied'], 2)  # the same count as the chart's today

    def test_answers_come_first_then_interviews_then_applying(self):
        rows = [row('a', 'Duvo.ai', 'SRE', stage='Screening'), row('b', 'Laelaps AI', 'Infra', stage='Screening'),
                row('c', 'Scale AI', 'Infra', interview='2026-09-29T09:00:00+02:00', stage='Interview scheduled'),
                row('d', 'Grafana Labs', 'SRE UK', stage='Kit ready', applied=None, Fit_score={'type': 'number', 'number': 76})]
        events = [event('a', 'Reply received', '2026-09-27T10:00:00Z', 'Asked for times', 'gm1'),
                  event('b', 'Reply received', '2026-09-28T08:00:00Z', 'Please book a slot on Calendly', 'gm2'),
                  event('b', 'Replied', '2026-09-28T09:00:00Z')]
        result = focus.build(rows, events, target=30, now=NOW)
        kinds = [(i['kind'], i['company']) for i in result['items']]
        self.assertEqual(kinds[:3], [('reply', 'Duvo.ai'), ('prepare', 'Scale AI'), ('apply', '')])
        reply = result['items'][0]
        self.assertEqual((reply['link'], reply['done']), ('https://mail.google.com/mail/u/0/#all/gm1', True))
        self.assertIn('yesterday', reply['detail'])
        self.assertIn('1 kit ready (Grafana Labs…)', result['items'][2]['detail'])
        self.assertNotIn('Laelaps AI', [c for _, c in kinds])  # answered: a Replied event came after
        self.assertEqual(result['summary'], 'Reply to recruiters first, then prepare for your interview.')
        self.assertEqual(result['items'][2]['meta'], ['1 application kit ready to review', '0 of 30 today'])

    def test_a_recruiter_pitch_links_to_its_email_and_shows_the_facts(self):
        lead = row('a', '', 'Senior DevOps Engineer', stage='Recruiter lead', applied=None, Via='AG Talent',
                   Salary='€70–90k + equity', Location='Remote (Europe)', Contact='Arjun Gillard · a@agtalent.co.uk',
                   Reached_via={'type': 'select', 'select': {'name': 'Email'}})
        lead['properties']['Job URL']['url'] = 'https://mail.google.com/mail/u/0/#all/1a0e86124ae7e2f5'
        item = focus.build([lead], [event('a', 'Recruiter lead', '2026-09-28T14:17:00Z', 'Recruiter message: …')], now=NOW)['items'][0]
        self.assertEqual(item['title'], 'Reply by email: AG Talent — Senior DevOps Engineer')
        self.assertEqual(item['link'], 'https://mail.google.com/mail/u/0/#all/1a0e86124ae7e2f5')
        self.assertEqual(item['detail'], 'Recruiter pitch today (Email). €70–90k + equity · Remote (Europe) · Arjun Gillard')
        self.assertEqual((item['icon'], item['badge'], item['headline']), ('mail', 'Reply today', 'Reply to AG Talent recruiter'))
        self.assertEqual(item['meta'], ['Senior DevOps Engineer', 'Email', '€70–90k + equity', 'Remote (Europe)'])

    def test_a_booking_invite_and_an_offer(self):
        rows = [row('a', 'Acme', 'SRE', stage='Screening'), row('b', 'Zeta', 'SRE', stage='Offer')]
        events = [event('a', 'Reply received', '2026-09-28T08:00:00Z', 'Pick a time that works for you'),
                  event('b', 'Offer', '2026-09-28T09:00:00Z', 'CHF 160k')]
        self.assertEqual([i['kind'] for i in focus.build(rows, events, now=NOW)['items']][:2], ['offer', 'book'])

    def test_the_daily_target_counts_todays_applications(self):
        rows = [row('a', 'A', 'x', applied='2026-09-28'), row('b', 'B', 'y', applied='2026-09-20'), row('c', 'C', 'z', applied='2026-09-20')]
        events = [event('b', 'Applied', '2026-09-28T09:00:00+02:00')]
        result = focus.build(rows, events, target=3, now=NOW)
        self.assertEqual({k: v for k, v in result['today'].items() if k != 'history'}, {'applied': 2, 'target': 3, 'kits_ready': 0})
        apply = next(i for i in result['items'] if i['kind'] == 'apply')
        self.assertEqual(apply['title'], 'Apply to 1 more job today')
        self.assertFalse(any(i['kind'] == 'apply' for i in focus.build(rows, events, target=2, now=NOW)['items']))
        waiting = next(i for i in result['items'] if i['kind'] == 'waiting')
        self.assertIn('2 applications waiting', waiting['title'])  # b and c: applied 8 days ago, no human reply

    def test_after_an_interview_review_it_and_a_quiet_screening_gets_a_nudge(self):
        rows = [row('a', 'Acme', 'SRE', stage='Interviewing', interview='2026-09-27T14:00:00+02:00'),
                row('b', 'Beta', 'SRE', stage='Screening')]
        events = [event('b', 'Screening', '2026-09-22T10:00:00Z')]
        kinds = [i['kind'] for i in focus.build(rows, events, now=NOW)['items']]
        self.assertEqual(kinds[:2], ['happened', 'nudge'])  # nothing recorded: did it happen?
        saved = [{'properties': {'Date': {'type': 'date', 'date': {'start': '2026-09-27'}},
                                 'Application': {'type': 'relation', 'relation': [{'id': 'a'}]}}}]
        kinds = [i['kind'] for i in focus.build(rows, events, saved, now=NOW)['items']]
        self.assertIn('review', kinds)  # recorded, not reviewed: one item, review it
        self.assertNotIn('happened', kinds)
        saved[0]['properties']['Overall'] = {'type': 'select', 'select': {'name': 'positive'}}
        self.assertNotIn('review', [i['kind'] for i in focus.build(rows, events, saved, now=NOW)['items']])

    def test_rejected_jobs_leave_the_list_but_their_lesson_is_shown(self):
        rows = [row('a', 'Canonical', 'SRE', stage='Rejected', Rejection_lesson='Lead with Python.',
                    Rejection_reason={'type': 'select', 'select': {'name': 'Hard skills'}})]
        events = [event('a', 'Reply received', '2026-09-28T08:00:00Z')]
        result = focus.build(rows, events, target=0, now=NOW)
        self.assertEqual(result['items'], [])
        self.assertEqual((result['insight']['reason'], result['insight']['headline']), ('Hard skills', 'Lead with Python'))
        self.assertEqual(result['summary'], "You're up to date. A good moment to apply to a few more jobs.")

    def test_the_funnel_counts_each_step_from_the_same_rows(self):
        rows = [row('a', 'A', 'x', stage='Rejected'), row('b', 'B', 'y', stage='Screening'), row('c', 'C', 'z', stage='Kit ready', applied=None)]
        events = [event('a', 'Reply received', '2026-09-27T10:00:00Z')]
        funnel = {s['step']: s for s in focus.build(rows, events, now=NOW)['funnel']['steps']}
        self.assertEqual([funnel[k]['reached'] for k in ('📝 Prepared', '📨 Applied', '💬 Human reply', '📞 Screening')], [3, 2, 2, 1])
        # Each step names every application that ever reached it (a rejected one stays), for the Jobs list a click shows.
        self.assertEqual(funnel['💬 Human reply']['urls'], ['https://x.test/a', 'https://x.test/b'])
        self.assertEqual(funnel['📞 Screening']['urls'], ['https://x.test/b'])

    def test_the_funnel_counts_outbound_only_and_inbound_apart(self):
        select = lambda name: {'type': 'select', 'select': {'name': name}}
        rows = [row('a', 'A', 'x', stage='Screening', Source=select('Job Pilotto app')),  # you applied: outbound
                row('b', 'B', 'y', stage='Applied', Source=select('Gmail')),  # a confirmation email: outbound
                row('l', 'Agency', 'SRE', stage='Recruiter lead', applied=None, Source=select('Gmail')),
                row('m', 'Acme', 'SRE', stage='Screening', applied=None, Source=select('Job Pilotto app'),
                    Notes='Recruiter message (Email). Client: fintech'),
                row('n', 'Beta', 'SRE', stage='Interviewing', applied=None, Source=select('LinkedIn')),
                row('o', 'Old', 'SRE', stage='Rejected', applied=None, Source=select('Phone'))]
        events = [event('o', 'Screening', '2026-09-20T10:00:00Z')]
        result = focus.build(rows, events, now=NOW)['funnel']
        steps = {s['step']: s['reached'] for s in result['steps']}
        self.assertEqual([steps[k] for k in ('📝 Prepared', '📨 Applied', '📞 Screening', '🧑‍💻 Interviews')], [2, 2, 1, 0])
        inbound = result['inbound']
        self.assertEqual({k: inbound[k] for k in ('contacted', 'screening', 'interviews', 'offers')},
                         {'contacted': 4, 'screening': 3, 'interviews': 1, 'offers': 0})
        # The Inbound funnel card: ever reached, share of those who contacted you, and the links a click lists.
        self.assertEqual([(s['step'], s['reached']) for s in inbound['steps']],
                         [('📥 Contacted you', 4), ('📞 Screening', 3), ('🧑‍💻 Interviews', 1), ('🏆 Offers', 0)])
        self.assertEqual(inbound['steps'][1]['of_contacted'], 0.75)
        self.assertEqual(inbound['steps'][0]['urls'], ['https://x.test/l', 'https://x.test/m', 'https://x.test/n', 'https://x.test/o'])
        self.assertEqual(inbound['steps'][1]['urls'], ['https://x.test/m', 'https://x.test/n', 'https://x.test/o'])
        self.assertEqual(inbound['steps'][2]['urls'], ['https://x.test/n'])
        # Inbound rows are in no outbound step's links.
        outbound_urls = {u for s in result['steps'] for u in s['urls']}
        self.assertEqual(outbound_urls, {'https://x.test/a', 'https://x.test/b'})
        # No Source at all: outbound, as before; no inbound steps reached.
        plain_rows = [row('a', 'A', 'x', stage='Applied')]
        empty = focus.build(plain_rows, [], now=NOW)['funnel']['inbound']
        self.assertEqual((empty['contacted'], [s['reached'] for s in empty['steps']]), (0, [0, 0, 0, 0]))

    def test_the_first_contact_decides_the_focus_funnel_side(self):
        # Applied, then the recruiter answered: outbound; the recruiter wrote first, then you applied: inbound.
        rows = [row('e', 'E', 'SRE', stage='Screening'), row('f', 'F', 'SRE', stage='Screening')]
        events = [event('e', 'Recruiter lead', '2026-09-10T09:00:00Z'), event('e', 'Applied', '2026-09-01T09:00:00Z'),
                  event('f', 'Applied', '2026-09-10T09:00:00Z'), event('f', 'Recruiter lead', '2026-09-01T09:00:00Z')]
        result = focus.build(rows, events, now=NOW)['funnel']
        self.assertEqual(result['inbound']['steps'][0]['urls'], ['https://x.test/f'])
        self.assertEqual(result['steps'][1]['urls'], ['https://x.test/e'])

    def test_reminder_only_when_worth_it(self):
        calm = {'today': {'applied': 30, 'target': 30, 'kits_ready': 0}, 'items': []}
        self.assertEqual(focus.reminder(calm, now=NOW), '')
        busy = {'today': {'applied': 4, 'target': 30, 'kits_ready': 6},
                'items': [{'kind': 'reply', 'company': 'Duvo.ai', 'priority': 1}]}
        text = focus.reminder(busy, now=NOW)
        self.assertIn('1 person waits for your answer: Duvo.ai', text)
        self.assertIn('4/30 applications today; 6 kits ready', text)


if __name__ == '__main__':
    unittest.main()


class AfterInterviewTests(unittest.TestCase):
    """The owner's Huxley case (30 Sep 2026): after the call, Focus said "Move Huxley forward · nothing booked"."""

    @staticmethod
    def reviewed(page_id, day, next_step='Call with the CTO next week'):
        return {'properties': {'Date': {'type': 'date', 'date': {'start': day}}, 'Overall': {'type': 'select', 'select': {'name': 'positive'}},
                               'Next step': text(next_step), 'Application': {'type': 'relation', 'relation': [{'id': page_id}]}}}

    def test_nothing_recorded_after_the_time_asks_if_it_happened_one_item_per_interview(self):
        rows = [row('h', 'Huxley', 'Principal SRE', stage='Interview scheduled', interview='2026-09-20T08:30:00+02:00')]
        items = focus.build(rows, [], now=NOW)['items']
        asked = [i for i in items if i['job'] == 'Principal SRE']
        self.assertEqual([i['kind'] for i in asked], ['happened'])  # no 3-day limit, and no nudge next to it
        self.assertEqual(asked[0]['headline'], 'Interview with Huxley')
        self.assertEqual(asked[0]['badge'], 'Did it happen?')

    def test_after_a_reviewed_interview_it_waits_calmly_then_nudges_after_quiet_days(self):
        # The review moved it to Interviewing and cleared the past date; Stage left at Interview scheduled works too.
        for stage, interview in (('Interviewing', None), ('Interview scheduled', '2026-09-27T08:30:00+02:00')):
            rows = [row('h', 'Huxley', 'Principal SRE', stage=stage, interview=interview)]
            events = [event('h', 'Interview scheduled', '2026-09-20T10:00:00Z')]
            item, = [i for i in focus.build(rows, events, [self.reviewed('h', '2026-09-27')], now=NOW)['items'] if i['job']]
            self.assertEqual((item['kind'], item['headline'], item['badge']), ('waiting', "Waiting for Huxley's next step", 'Waiting'))
            self.assertIn('Call with the CTO next week', item['meta'])
            self.assertIn('Call with the CTO next week', item['detail'])
        rows = [row('h', 'Huxley', 'Principal SRE', stage='Interviewing')]
        focus_ = focus.build(rows, events, [self.reviewed('h', '2026-09-27')], now=NOW)
        self.assertNotIn('Follow up on applications waiting', focus_['summary'])
        # QUIET_DAYS without news since the interview: now it's a nudge.
        quiet = focus.build(rows, events, [self.reviewed('h', '2026-09-24')], now=NOW)['items']
        nudge, = [i for i in quiet if i['job']]
        self.assertEqual(nudge['kind'], 'nudge')
        self.assertIn('No news for 4 days since the interview', nudge['detail'])
        # News after the interview (the Gmail check logged a step) restarts the quiet time.
        news = events + [event('h', 'Interviewing', '2026-09-27T09:00:00Z')]
        self.assertEqual([i['kind'] for i in focus.build(rows, news, [self.reviewed('h', '2026-09-24')], now=NOW)['items'] if i['job']],
                         ['waiting'])
        # A month of silence after an interview isn't a to-do any more.
        self.assertEqual([i for i in focus.build(rows, [], [self.reviewed('h', '2026-08-20')], now=NOW)['items'] if i['job']
                          and i['stage'] == 'Interviewing'], [])


class AddDetailsTests(unittest.TestCase):
    def test_an_interview_known_only_from_the_invitation_asks_for_the_details(self):
        invite = row('h1', '', 'Connect Igor / Jaya - SRE', stage='Interview scheduled', applied=None,
                     interview='2026-09-30T08:30:00+02:00', Via='Huxley')
        invite['properties']['Job URL'] = {'type': 'url', 'url': 'https://mail.google.com/mail/u/0/#all/h1'}
        known = row('k1', 'Acme', 'SRE', stage='Interview scheduled', interview='2026-10-02T10:00:00+02:00', Salary='CHF 150k')
        items = focus.build([invite, known], [], target=0, now=NOW)['items']
        asks = [i for i in items if i['kind'] == 'details']
        self.assertEqual(len(asks), 1)
        self.assertEqual(asks[0]['title'], 'Add details: Huxley — Connect Igor / Jaya - SRE')
        self.assertEqual(asks[0]['missing'], ['company', 'salary', 'job description'])
        self.assertIn('Wed 30 Sep, 08:30', asks[0]['detail'])
        self.assertIn('prepare', [i['kind'] for i in items])  # still reminded to prepare

    def test_a_named_employer_without_pay_or_posting_still_asks(self):
        lead = row('l1', 'Acme', 'SRE', stage='Interview scheduled')
        lead['properties']['Job URL'] = {'type': 'url', 'url': 'https://www.linkedin.com/messaging/#jp-abc'}
        asks = [i for i in focus.build([lead], [], target=0, now=NOW)['items'] if i['kind'] == 'details']
        self.assertEqual(asks[0]['missing'], ['salary', 'job description'])

    def test_once_you_logged_details_it_stops_asking(self):
        invite = row('h1', '', 'Principal SRE', stage='Interview scheduled', interview='2026-09-30T08:30:00+02:00', Via='Huxley')
        invite['properties']['Job URL'] = {'type': 'url', 'url': 'https://mail.google.com/mail/u/0/#all/h1'}
        logged = event('h1', 'Interview scheduled', '2026-09-29T13:23:00Z', source_id='paste:abc')
        kinds = [i['kind'] for i in focus.build([invite], [logged], target=0, now=NOW)['items']]
        self.assertNotIn('details', kinds)
        self.assertIn('prepare', kinds)

    def test_only_talking_to_an_agency_with_a_hidden_employer_is_not_a_to_do(self):
        pitch = row('a1', '', 'Senior DevOps Engineer', stage='Screening', Via='AG Talent', Salary='€70k–90k')
        self.assertFalse([i for i in focus.build([pitch], [], target=0, now=NOW)['items'] if i['kind'] == 'details'])


class ParallelReadsTests(unittest.TestCase):
    def test_reads_run_at_the_same_time_and_keep_their_order(self):
        import threading
        from src.notion.client import together
        # Two reads at a time (workers=2, Notion's limit): each read waits at the barrier for a second one, so one at a
        # time would time out (BrokenBarrierError). No wall-clock limit, so a slow CI runner can't fail it.
        barrier = threading.Barrier(2, timeout=5)
        results = together(*[lambda n=n: (barrier.wait(), n)[1] for n in range(4)])
        self.assertEqual(results, [0, 1, 2, 3])

    def test_the_profile_page_is_read_once_per_run(self):
        from src.notion.client import Tracker
        calls = []
        tracker = Tracker('token', 'db')
        tracker._children = lambda block_id: calls.append(block_id) or [
            {'type': 'paragraph', 'paragraph': {'rich_text': [{'plain_text': 'Salary: CHF 150k'}]}}]
        self.assertEqual(tracker.page_text('p1'), tracker.page_text('p1'))
        self.assertEqual(calls, ['p1'])


class HistoryInterviewTest(unittest.TestCase):
    def test_reviewed_interviews_show_in_history(self):
        from datetime import date as _date
        from unittest import mock
        from src import focus
        from src.ai import interviews
        today = _date.today().isoformat()
        rows = [{'url': 'https://notion.so/i1', 'last_edited_time': f'{today}T08:00:00.000Z',
                 'properties': {'Interview': {'type': 'title', 'title': [{'plain_text': 'Unframe · Recruiter screen'}]},
                                'Overall': {'type': 'select', 'select': {'name': 'neutral'}}}},
                {'url': 'https://notion.so/old', 'last_edited_time': '2000-01-01T08:00:00.000Z',
                 'properties': {'Interview': {'type': 'title', 'title': [{'plain_text': 'Old'}]},
                                'Overall': {'type': 'select', 'select': {'name': 'positive'}}}}]

        class Tracker:
            def query_database(self, db, filt=None):
                return rows if db == 'IV' else []
        with mock.patch.object(focus, 'EVENTS_DATABASE_ID', ''), mock.patch.object(interviews, 'INTERVIEWS_DATABASE_ID', 'IV'), \
                mock.patch('src.ai.insights.INSIGHTS_DATABASE_ID', ''):
            items = focus.history(Tracker())
        self.assertEqual([i['title'] for i in items], ['Reviewed the interview: Unframe · Recruiter screen'])
        self.assertEqual(items[0]['note'], 'Outcome: Neutral')

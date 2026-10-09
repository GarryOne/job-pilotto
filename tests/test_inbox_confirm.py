"""The app's "log anything" asks before it writes: Claude reads once (propose), you confirm what it couldn't see
(channel, start date with its year, kind, a call's time, the company), then log() writes with your answers."""
import unittest
from datetime import datetime, timezone

from src.ai import inbox
from src.stores import memory
from tests.test_inbox import Inbox, SHOT, job, reading, row
from tests.mail_fakes import stores_for
from tests.test_inbox_gaps import gmail_lead, now_of
from tests.test_opportunity import Client

NOW = datetime(2026, 9, 30, 9, 0, tzinfo=timezone.utc)
SEEN = {'channel': 'shown', 'year': 'shown', 'first_contact': 'shown', 'interview': 'none', 'company': 'shown'}


def chat(**fields):
    """A LinkedIn chat screenshot read by Claude (fields override)."""
    seen = dict(SEEN, **fields.pop('seen', {}))
    return reading(fields.pop('kind', 'Recruiter outreach'), fields.pop('match', -1), platform=fields.pop('platform', 'LinkedIn'), seen=seen,
                   first_contact_text=fields.pop('first_contact_text', ''), interview_text=fields.pop('interview_text', ''),
                   first_contact=fields.pop('first_contact', ''), **fields)


class Writes(Inbox):
    """Counts every Notion write (and upload): propose must make none."""

    def writes(self):
        return self.created + self.updates + self.appended + self.uploads


class ProposeTests(unittest.TestCase):
    def test_the_30_sep_bug_no_year_shown_means_the_year_is_asked_not_assumed(self):
        # A LinkedIn chat screenshot: "Sep 21", a call "Friday at 3pm". Claude read 2024; it once became 21 Sep 2024,
        # a call on 26 Sep 2024, Kind "Interview scheduled", Source Telegram: all guesses.
        answer = chat(kind='Interview scheduled', when='2024-09-21T10:00:00+00:00', first_contact='2024-09-21T10:00:00+00:00',
                      first_contact_text='Sep 21', interview_at='2024-09-26T15:00:00+02:00', interview_text='Friday at 3pm',
                      company='Example Robotics', role='Senior SRE',
                      seen={'year': 'missing', 'interview': 'partial', 'company': 'guessed', 'channel': 'guessed'})
        tracker = Writes()
        proposal = inbox.propose(stores_for(tracker), image=SHOT, client=Client(answer), now=NOW)
        fields = proposal['fields']
        self.assertEqual(tracker.writes(), [])  # nothing in Notion before you confirm
        self.assertEqual((fields['started']['value'], fields['started']['state']), ('', 'ask'))
        self.assertEqual(fields['started']['years'], [2026, 2025])
        self.assertEqual(fields['started']['question'], 'Which year was "Sep 21"?')
        self.assertEqual((fields['interview']['value'], fields['interview']['state']), ('', 'ask'))
        self.assertEqual(fields['interview']['as_written'], 'Friday at 3pm')
        self.assertEqual(fields['kind'], {'value': 'Interview scheduled', 'state': 'check', 'options': fields['kind']['options']})
        self.assertEqual((fields['channel']['value'], fields['channel']['state']), ('LinkedIn', 'check'))
        self.assertEqual((fields['company']['value'], fields['company']['state']), ('Example Robotics', 'check'))
        self.assertNotIn('2024', str({k: f.get('value') for k, f in fields.items()}))

    def test_what_the_message_shows_is_prefilled_and_needs_no_confirm(self):
        answer = chat(when='2026-09-21T10:00:00+00:00', first_contact='2026-09-21T10:00:00+00:00')
        fields = inbox.propose(stores_for(Writes()), image=SHOT, client=Client(answer), now=NOW)['fields']
        self.assertEqual((fields['started']['value'], fields['started']['state']), ('2026-09-21', 'ok'))
        self.assertEqual((fields['channel']['value'], fields['channel']['state']), ('LinkedIn', 'ok'))
        self.assertNotIn('interview', fields)

    def test_no_channel_seen_is_left_empty(self):
        answer = chat(platform='Other', seen={'channel': 'unknown'})
        fields = inbox.propose(stores_for(Writes()), image=SHOT, client=Client(answer), now=NOW)['fields']
        self.assertEqual((fields['channel']['value'], fields['channel']['state']), ('', 'ask'))


class ConfirmedTests(unittest.TestCase):
    def test_the_confirmed_channel_overrides_the_guess(self):
        tracker = Inbox()
        client = Client(chat(when='2026-09-21T10:00:00+00:00'))  # Claude says LinkedIn
        proposal = inbox.propose(stores_for(tracker), image=SHOT, client=client, now=NOW)
        proposal = inbox.confirm(proposal, channel='Email', started='2026-09-21', first_contact=True)
        inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=proposal)
        lead = tracker.created[0]
        self.assertEqual(lead['Source'], {'select': {'name': 'Gmail'}})
        self.assertEqual(lead['Reached via'], {'select': {'name': 'Email'}})
        self.assertEqual(len(client.calls), 1)  # one reading: the write step doesn't read again

    def test_a_new_jobs_first_event_is_dated_when_the_conversation_began(self):
        tracker = Inbox()
        proposal = inbox.propose(stores_for(tracker), image=SHOT, client=Client(chat(when='2026-09-29T10:00:00+00:00')), now=NOW)
        inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=inbox.confirm(proposal, channel='LinkedIn', started='2026-09-21',
                                                                        first_contact=True))
        event = tracker.created[1]
        self.assertEqual(event['Kind'], {'select': {'name': 'Recruiter lead'}})
        self.assertEqual(event['At']['date']['start'][:10], '2026-09-21')
        self.assertEqual(tracker.created[0]['Source'], {'select': {'name': 'LinkedIn'}})

    def test_not_the_first_contact_keeps_source_how_it_was_added(self):
        tracker = Inbox()
        proposal = inbox.propose(stores_for(tracker), image=SHOT, client=Client(chat()), now=NOW)
        inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=inbox.confirm(proposal, channel='LinkedIn', started='2026-09-21',
                                                                        first_contact=False))
        self.assertEqual(tracker.created[0]['Source'], {'select': {'name': 'Manual'}})

    def test_the_confirmed_start_date_drives_the_earliest_contact_rule(self):
        # The Gmail check tracked the job on 29 Sep. Claude read the LinkedIn chat as starting 30 Sep (later: no
        # change); you say it began 21 Sep: that's earlier, so Source and Reached via follow LinkedIn.
        proposal = {'item': {'platform': 'LinkedIn', 'first_contact': '2026-09-30T09:00:00Z', 'seen': SEEN}, 'kind': 'Reply received'}
        stores = memory.open_store()
        self.assertEqual(inbox._fill_gaps(stores, gmail_lead(stores), proposal['item']), [])
        confirmed = inbox.confirm(proposal, started='2026-09-21')
        stores = memory.open_store()
        self.assertEqual(inbox._fill_gaps(stores, gmail_lead(stores), confirmed['item']), ['first contact on LinkedIn'])
        self.assertEqual(now_of(stores)['source'], 'LinkedIn')

    def test_the_year_you_pick_dates_the_message_and_a_guessed_call_time_is_dropped(self):
        item = chat(kind='Reply received', when='2024-09-23T10:00:00+00:00', interview_at='2024-09-26T15:00:00+02:00',
                    seen={'year': 'missing', 'interview': 'partial'})
        confirmed = inbox.confirm({'item': item, 'kind': 'Reply received'}, started='2026-09-21', kind='Reply received')
        self.assertEqual(confirmed['item']['when'][:10], '2026-09-23')
        self.assertEqual(confirmed['item']['interview_at'], '')
        booked = inbox.confirm({'item': item, 'kind': 'Reply received'}, started='2026-09-21', kind='Interview scheduled',
                               interview_at='2026-10-03T15:00')
        self.assertEqual((booked['kind'], booked['item']['interview_at']), ('Interview scheduled', '2026-10-03T15:00'))

    def test_a_tracked_job_is_updated_with_the_kind_you_chose(self):
        tracker = Inbox([row('p1', 'https://x.test/1', 'SRE', 'Grafana Labs')], [job('https://x.test/1', 'SRE', 'Grafana Labs', 'Applied')])
        proposal = inbox.propose(stores_for(tracker), image=SHOT, client=Client(chat(kind='Interview scheduled', match=0)), now=NOW)
        self.assertFalse(proposal['new'])
        self.assertNotIn('company', proposal['fields'])
        line = inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=inbox.confirm(proposal, kind='Rejected', channel='LinkedIn',
                                                                               started='2026-09-21'))
        self.assertIn('→ Rejected', line)
        self.assertNotIn('Check:', line)

    def test_unconfirmed_logs_say_what_to_check(self):
        # Telegram / the terminal: nobody confirmed, so the reply and the page entry list what was taken on trust.
        tracker = Inbox([row('p1', 'https://x.test/1', 'SRE', 'Grafana Labs')], [job('https://x.test/1', 'SRE', 'Grafana Labs', 'Applied')])
        answer = chat(kind='Rejected', match=0, when='2024-09-21T10:00:00+00:00', first_contact_text='Sep 21',
                      seen={'year': 'missing', 'channel': 'guessed'})
        line = inbox.log(stores_for(tracker), image=SHOT, client=Client(answer), now=NOW)
        self.assertIn('⚠️ Check: year assumed "Sep 21"; channel LinkedIn guessed', line)
        entry = tracker.appended[0][1][-1]['toggle']['children'][0]
        self.assertIn('Check these details', entry['paragraph']['rich_text'][0]['text']['content'])



class AgreementTests(unittest.TestCase):
    """Did you agree to talk to the recruiter? Read from the conversation (seen.agreement), asked only when it's
    unclear and the job is new or still a Recruiter lead; never a checkbox before the reading."""

    def lead_tracker(self, stage='Recruiter lead'):
        return Inbox([row('p9', 'https://lead.test/1', 'Senior DevOps Engineer', stage=stage)],
                     [job('https://lead.test/1', 'Senior DevOps Engineer', '', stage, via='Example Talent')])

    def propose(self, tracker, agreement, **fields):
        answer = chat(seen={'agreement': agreement}, when='2026-09-21T10:00:00+00:00',
                      owner_agreed=fields.pop('owner_agreed', agreement == 'shown'), **fields)
        return inbox.propose(stores_for(tracker), image=SHOT, client=Client(answer), now=NOW)

    def save(self, tracker, proposal, **answers):
        return inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=inbox.confirm(proposal, channel='LinkedIn', started='2026-09-21', **answers))

    def test_a_new_job_shown_moves_to_screening_without_a_question(self):
        tracker = Writes()
        proposal = self.propose(tracker, 'shown')
        self.assertEqual(proposal['fields']['agree'], {'value': 'yes', 'state': 'ok', 'question': inbox.AGREE_QUESTION})
        self.save(tracker, proposal, agreed=True)
        self.assertEqual(tracker.created[0]['Stage'], {'select': {'name': 'Screening'}})

    def test_a_new_job_unclear_is_asked_and_your_answer_decides(self):
        for answer, stage in ((True, 'Screening'), (False, 'Recruiter lead')):
            tracker = Writes()
            proposal = self.propose(tracker, 'unclear')
            self.assertEqual((proposal['fields']['agree']['state'], proposal['fields']['agree']['value']), ('ask', ''))
            self.assertEqual(tracker.writes(), [])  # nothing written before it's answered
            self.save(tracker, proposal, agreed=answer)
            self.assertEqual(tracker.created[0]['Stage'], {'select': {'name': stage}})

    def test_a_new_job_with_no_reply_or_a_no_stays_a_lead_and_nothing_is_asked(self):
        for agreement in ('none', 'declined'):
            tracker = Writes()
            proposal = self.propose(tracker, agreement, owner_agreed=agreement == 'declined')  # a wrong flag: the evidence wins
            self.assertNotIn('agree', proposal['fields'])
            self.save(tracker, proposal)
            self.assertEqual(tracker.created[0]['Stage'], {'select': {'name': 'Recruiter lead'}}, agreement)

    def test_an_existing_recruiter_lead_is_asked_when_unclear_and_moves_on_yes(self):
        tracker = self.lead_tracker()
        proposal = self.propose(tracker, 'unclear', match=0)
        self.assertEqual(proposal['fields']['agree']['state'], 'ask')
        self.assertIn('→ Screening', self.save(tracker, proposal, agreed=True))
        self.assertIn(('p9', {'Stage': {'select': {'name': 'Screening'}}}), tracker.updates)
        tracker = self.lead_tracker()
        self.save(tracker, self.propose(tracker, 'unclear', match=0), agreed=False)
        self.assertNotIn(('p9', {'Stage': {'select': {'name': 'Screening'}}}), tracker.updates)

    def test_an_existing_lead_shown_moves_to_screening(self):
        tracker = self.lead_tracker()
        proposal = self.propose(tracker, 'shown', match=0)
        self.assertEqual(proposal['fields']['agree']['state'], 'ok')
        self.save(tracker, proposal)  # the pre-filled yes, even without an answer sent
        self.assertIn(('p9', {'Stage': {'select': {'name': 'Screening'}}}), tracker.updates)

    def test_a_job_past_the_lead_stage_is_never_asked(self):
        for stage in ('Screening', 'Applied', 'Interviewing'):
            for agreement in inbox.AGREEMENT:
                proposal = self.propose(self.lead_tracker(stage), agreement, match=0)
                self.assertNotIn('agree', proposal['fields'], (stage, agreement))

    def test_telegram_talking_still_moves_a_new_lead_and_an_unclear_reply_is_flagged(self):
        tracker = Inbox()
        inbox.log(stores_for(tracker), image=SHOT, client=Client(chat(seen={'agreement': 'none'})), now=NOW, talking=True)
        self.assertEqual(tracker.created[0]['Stage'], {'select': {'name': 'Screening'}})
        tracker = Inbox()
        line = inbox.log(stores_for(tracker), image=SHOT, client=Client(chat(seen={'agreement': 'unclear'})), now=NOW)
        self.assertEqual(tracker.created[0]['Stage'], {'select': {'name': 'Recruiter lead'}})
        self.assertIn('whether you agreed to talk to the recruiter (not moved to Screening)', line)

    def test_the_app_answer_reaches_log_through_daily_agreed(self):
        import json
        import sys
        import tempfile
        from types import SimpleNamespace
        from unittest import mock
        from src import daily, daily_modes
        tracker = Inbox()
        proposal = self.propose(Writes(), 'unclear')
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as saved:
            json.dump(proposal, saved, default=str)
        argv = ['daily', '--mode', 'add', '--from-app', '--reading', saved.name, '--channel', 'LinkedIn',
                '--started', '2026-09-21', '--agreed', 'yes', '--note', 'a pasted recruiter chat, long enough to log']
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(daily.notion.Tracker, 'from_env', lambda: tracker), \
                mock.patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'sk-test'}), \
                mock.patch.dict(sys.modules, {'anthropic': SimpleNamespace(Anthropic=lambda: None)}), \
                mock.patch.object(daily_modes, 'queue_mail_check', lambda: False), mock.patch('builtins.print'):
            self.assertEqual(daily.main(), 0)
        self.assertEqual(tracker.created[0]['Stage'], {'select': {'name': 'Screening'}})



class WhichJobTests(unittest.TestCase):
    """"Which job is this?" is asked after the reading only when the match isn't clear: Claude found none and several
    tracked jobs are from the same recruiter or company (or one is, but not plainly the same role)."""

    def tracker(self, *titles):
        rows = [row(f'p{i}', f'https://x.test/{i}', title, stage='Recruiter lead') for i, title in enumerate(titles)]
        jobs = [job(f'https://x.test/{i}', title, '', 'Recruiter lead', via='Example Talent') for i, title in enumerate(titles)]
        return Writes(rows, jobs + [job('https://x.test/other', 'SRE', 'Globex', 'Applied')])

    def propose(self, tracker, match=-1, role='Staff Data Engineer', **options):
        answer = chat(match=match, role=role, title=role, when='2026-09-21T10:00:00+00:00')
        return inbox.propose(stores_for(tracker), image=SHOT, client=Client(answer), now=NOW, **options)

    def test_two_jobs_from_the_same_agency_and_no_match_ask_which_one_before_anything_else(self):
        tracker = self.tracker('Senior DevOps Engineer', 'Platform Engineer')
        proposal = self.propose(tracker)
        asked = proposal['fields']['job']
        self.assertEqual(list(proposal['fields'])[0], 'job')
        self.assertEqual((asked['state'], asked['question']), ('ask', 'Which job is this?'))
        self.assertEqual([c['url'] for c in asked['candidates']], ['https://x.test/0', 'https://x.test/1'])
        self.assertEqual(asked['candidates'][0], {'url': 'https://x.test/0', 'stage': 'Recruiter lead', 'label': 'Example Talent · Senior DevOps Engineer'})
        self.assertEqual(tracker.writes(), [])
        with self.assertRaisesRegex(ValueError, 'which job'):
            inbox.confirm(proposal, channel='LinkedIn')  # nothing is written before you say which job

    def test_the_job_you_pick_is_proposed_again_from_the_same_reading(self):
        tracker = self.tracker('Senior DevOps Engineer', 'Platform Engineer')
        first = self.propose(tracker)
        again = inbox.propose(stores_for(tracker), item=first['item'], target='https://x.test/1', now=NOW)  # no client: no AI call
        self.assertNotIn('job', again['fields'])
        self.assertEqual((again['job']['url'], again['new'], again['target']), ('https://x.test/1', False, 'https://x.test/1'))
        line = inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=inbox.confirm(again, channel='LinkedIn', started='2026-09-21'))
        self.assertTrue(line.startswith('🧩 Updated: ? — Platform Engineer'), line)  # the job you picked, not a new one
        new = inbox.propose(stores_for(tracker), item=first['item'], target='new', now=NOW)
        self.assertTrue(new['new'])
        self.assertNotIn('job', new['fields'])

    def test_one_related_job_of_another_role_is_asked_the_same_role_is_not(self):
        self.assertEqual(len(self.propose(self.tracker('Senior DevOps Engineer'))['fields']['job']['candidates']), 1)
        same = self.propose(self.tracker('Senior DevOps Engineer'), role='Senior DevOps Engineer')
        self.assertNotIn('job', same['fields'])  # plainly the same pitch again (same_job)
        self.assertEqual(same['job']['url'], 'https://x.test/0')

    def test_a_job_claude_matched_or_you_chose_is_not_asked(self):
        tracker = self.tracker('Senior DevOps Engineer', 'Platform Engineer')
        self.assertNotIn('job', self.propose(tracker, match=1)['fields'])
        self.assertNotIn('job', self.propose(tracker, target='https://x.test/0')['fields'])
        self.assertNotIn('job', self.propose(Writes(), role='Staff SRE')['fields'])  # nothing related: a new job, clear

    def test_telegram_logs_an_unclear_match_and_says_to_check_it(self):
        tracker = self.tracker('Senior DevOps Engineer', 'Platform Engineer')
        answer = chat(role='Staff Data Engineer', title='Staff Data Engineer', when='2026-09-21T10:00:00+00:00')
        line = inbox.log(stores_for(tracker), image=SHOT, client=Client(answer), now=NOW)
        self.assertIn('which job it is (2 possible)', line)


if __name__ == '__main__':
    unittest.main()

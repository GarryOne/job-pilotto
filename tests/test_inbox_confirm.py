"""The app's "log anything" asks before it writes: Claude reads once (propose), you confirm what it couldn't see
(channel, start date with its year, kind, a call's time, the company), then log() writes with your answers."""
import unittest
from datetime import datetime, timezone

from src.ai import inbox
from tests.test_inbox import Inbox, SHOT, job, reading, row
from tests.test_inbox_gaps import EventsTracker, gmail_lead
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
        proposal = inbox.propose(tracker, image=SHOT, client=Client(answer), now=NOW)
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
        fields = inbox.propose(Writes(), image=SHOT, client=Client(answer), now=NOW)['fields']
        self.assertEqual((fields['started']['value'], fields['started']['state']), ('2026-09-21', 'ok'))
        self.assertEqual((fields['channel']['value'], fields['channel']['state']), ('LinkedIn', 'ok'))
        self.assertNotIn('interview', fields)

    def test_no_channel_seen_is_left_empty(self):
        answer = chat(platform='Other', seen={'channel': 'unknown'})
        fields = inbox.propose(Writes(), image=SHOT, client=Client(answer), now=NOW)['fields']
        self.assertEqual((fields['channel']['value'], fields['channel']['state']), ('', 'ask'))


class ConfirmedTests(unittest.TestCase):
    def test_the_confirmed_channel_overrides_the_guess(self):
        tracker = Inbox()
        client = Client(chat(when='2026-09-21T10:00:00+00:00'))  # Claude says LinkedIn
        proposal = inbox.propose(tracker, image=SHOT, client=client, now=NOW)
        proposal = inbox.confirm(proposal, channel='Email', started='2026-09-21', first_contact=True)
        inbox.log(tracker, image=SHOT, now=NOW, proposal=proposal)
        lead = tracker.created[0]
        self.assertEqual(lead['Source'], {'select': {'name': 'Gmail'}})
        self.assertEqual(lead['Reached via'], {'select': {'name': 'Email'}})
        self.assertEqual(len(client.calls), 1)  # one reading: the write step doesn't read again

    def test_a_new_jobs_first_event_is_dated_when_the_conversation_began(self):
        tracker = Inbox()
        proposal = inbox.propose(tracker, image=SHOT, client=Client(chat(when='2026-09-29T10:00:00+00:00')), now=NOW)
        inbox.log(tracker, image=SHOT, now=NOW, proposal=inbox.confirm(proposal, channel='LinkedIn', started='2026-09-21',
                                                                        first_contact=True))
        event = tracker.created[1]
        self.assertEqual(event['Kind'], {'select': {'name': 'Recruiter lead'}})
        self.assertEqual(event['At']['date']['start'][:10], '2026-09-21')
        self.assertEqual(tracker.created[0]['Source'], {'select': {'name': 'LinkedIn'}})

    def test_not_the_first_contact_keeps_source_how_it_was_added(self):
        tracker = Inbox()
        proposal = inbox.propose(tracker, image=SHOT, client=Client(chat()), now=NOW)
        inbox.log(tracker, image=SHOT, now=NOW, proposal=inbox.confirm(proposal, channel='LinkedIn', started='2026-09-21',
                                                                        first_contact=False))
        self.assertEqual(tracker.created[0]['Source'], {'select': {'name': 'Manual'}})

    def test_the_confirmed_start_date_drives_the_earliest_contact_rule(self):
        # The Gmail check tracked the job on 29 Sep. Claude read the LinkedIn chat as starting 30 Sep (later: no
        # change); you say it began 21 Sep: that's earlier, so Source and Reached via follow LinkedIn.
        proposal = {'item': {'platform': 'LinkedIn', 'first_contact': '2026-09-30T09:00:00Z', 'seen': SEEN}, 'kind': 'Reply received'}
        self.assertEqual(inbox._fill_gaps(EventsTracker(), gmail_lead(), proposal['item']), [])
        confirmed = inbox.confirm(proposal, started='2026-09-21')
        tracker = EventsTracker()
        self.assertEqual(inbox._fill_gaps(tracker, gmail_lead(), confirmed['item']), ['first contact on LinkedIn'])
        self.assertEqual(tracker.updates[0][1]['Source'], {'select': {'name': 'LinkedIn'}})

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
        proposal = inbox.propose(tracker, image=SHOT, client=Client(chat(kind='Interview scheduled', match=0)), now=NOW)
        self.assertFalse(proposal['new'])
        self.assertNotIn('company', proposal['fields'])
        line = inbox.log(tracker, image=SHOT, now=NOW, proposal=inbox.confirm(proposal, kind='Rejected', channel='LinkedIn',
                                                                               started='2026-09-21'))
        self.assertIn('→ Rejected', line)
        self.assertNotIn('Check:', line)

    def test_unconfirmed_logs_say_what_to_check(self):
        # Telegram / the terminal: nobody confirmed, so the reply and the page entry list what was taken on trust.
        tracker = Inbox([row('p1', 'https://x.test/1', 'SRE', 'Grafana Labs')], [job('https://x.test/1', 'SRE', 'Grafana Labs', 'Applied')])
        answer = chat(kind='Rejected', match=0, when='2024-09-21T10:00:00+00:00', first_contact_text='Sep 21',
                      seen={'year': 'missing', 'channel': 'guessed'})
        line = inbox.log(tracker, image=SHOT, client=Client(answer), now=NOW)
        self.assertIn('⚠️ Check: year assumed "Sep 21"; channel LinkedIn guessed', line)
        entry = tracker.appended[0][1][-1]['toggle']['children'][0]
        self.assertIn('Check these details', entry['paragraph']['rich_text'][0]['text']['content'])


if __name__ == '__main__':
    unittest.main()

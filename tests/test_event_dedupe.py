"""One 📈 Application Events row per real occurrence: add_event is idempotent, the stage watcher doesn't repeat
Job Pilotto's own events, a calendar invite that adopts the watcher's guess says so, and an impossible interview time
(a pasted chat's "Sep 26" read as 2024 in 2026: the Huxley case) is never stored."""
import io
import sys
import unittest
from contextlib import redirect_stderr
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import inbox, mail
from src.notion import ledger

NOW = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
APP_ID = 'app-huxley'


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def app(stage='Screening'):
    return {'id': APP_ID, 'last_edited_time': '2026-09-30T10:00:00+00:00', 'properties': {
        'Company': text('Huxley'), 'Job': {'type': 'title', 'title': [{'plain_text': 'Principal SRE'}]},
        'Stage': {'type': 'select', 'select': {'name': stage}}, 'Applied on': {'type': 'date', 'date': None},
        'Next interview': {'type': 'date', 'date': None}, 'Job URL': {'type': 'url', 'url': 'https://x.test/h'}}}


def stored(properties, page_id):
    """A created page as Notion returns it (typed properties with plain_text)."""
    out = {}
    for name, value in properties.items():
        if 'rich_text' in value:
            out[name] = text(''.join(t['text']['content'] for t in value['rich_text']))
        elif 'title' in value:
            out[name] = {'type': 'title', 'title': [{'plain_text': value['title'][0]['text']['content']}]}
        elif 'select' in value:
            out[name] = {'type': 'select', 'select': value['select']}
        elif 'date' in value:
            out[name] = {'type': 'date', 'date': value['date']}
        else:
            out[name] = {'type': next(iter(value)), **value}
    return {'id': page_id, 'properties': out}


class Tracker:
    """Applications + events in memory: create/update/trash really change what the next query returns."""
    database_id = 'apps'

    def __init__(self, row, events=()):
        self.rows, self.events, self.trashed = [row], list(events), []

    def query_database(self, database_id, filter_=None):
        return list(self.events) if database_id == ledger.EVENTS_DATABASE_ID else list(self.rows)

    def create_page(self, database_id, properties):
        page = stored(properties, f'ev-{len(self.events) + 1}')
        self.events.append(page)
        return page

    def update_page(self, page_id, properties):
        for page in self.events + self.rows:
            if page['id'] == page_id:
                page['properties'].update(stored(properties, page_id)['properties'])

    def trash_page(self, page_id):
        self.trashed.append(page_id)
        self.events = [e for e in self.events if e['id'] != page_id]

    def kinds(self):
        return [ledger.plain(e['properties']['Kind']) for e in self.events]


def event(page_id, kind, at, source='Gmail', source_id='', note='', changes=''):
    props = {'Kind': {'type': 'select', 'select': {'name': kind}}, 'At': {'type': 'date', 'date': {'start': at}},
             'Source': {'type': 'select', 'select': {'name': source}}, 'Source ID': text(source_id), 'Note': text(note),
             'Application': {'type': 'relation', 'relation': [{'id': APP_ID}]}}
    if changes:
        props['Changes'] = text(changes)
    return {'id': page_id, 'properties': props}


INVITE = '2026-10-02T14:00:00+02:00'


class WritersDoNotRepeatTests(unittest.TestCase):
    def gmail(self, tracker, source_id, interview_at=INVITE, at='2026-09-28T09:00:00+00:00'):
        return mail.record(tracker, tracker.rows[0], 'Interview scheduled', at, 'Gmail', source_id, '', ({*()}, {}),
                           interview_at=interview_at, now=NOW)

    def index(self, tracker):
        return mail._events_index(tracker)

    def test_a_gmail_invite_then_the_watcher_is_one_interview_event(self):
        tracker = Tracker(app('Interviewing'))
        tracker.events.append(event('ev-0', 'Screening', '2026-09-29T08:00:00+00:00'))  # a later event of another kind
        mail.record(tracker, tracker.rows[0], 'Interview scheduled', '2026-09-28T09:00:00+00:00', 'Gmail', 'g1', '',
                    self.index(tracker), interview_at=INVITE, now=NOW)
        tracker.rows[0]['properties']['Stage'] = {'type': 'select', 'select': {'name': 'Interview scheduled'}}
        ledger.sync(tracker, now=NOW)
        ledger.sync(tracker, now=NOW)
        self.assertEqual(tracker.kinds().count('Interview scheduled'), 1)

    def test_the_watcher_skips_a_kind_the_application_already_has(self):
        tracker = Tracker(app('Interview scheduled'), [
            event('e1', 'Interview scheduled', '2026-09-28T09:00:00+00:00', source_id='g1'),
            event('e2', 'Screening', '2026-09-29T09:00:00+00:00')])  # newest event is another kind
        ledger.sync(tracker, now=NOW)
        self.assertEqual(tracker.kinds(), ['Interview scheduled', 'Screening'])

    def test_a_second_interview_on_another_date_is_a_second_event(self):
        tracker = Tracker(app())
        self.gmail(tracker, 'g1')
        self.gmail(tracker, 'g2', interview_at='2026-10-09T10:00:00+02:00')
        self.assertEqual(tracker.kinds(), ['Interview scheduled', 'Interview scheduled'])

    def test_the_same_interview_from_another_message_is_not_written_again(self):
        tracker = Tracker(app())
        index = self.index(tracker)
        mail.record(tracker, tracker.rows[0], 'Interview scheduled', '2026-09-28T09:00:00+00:00', 'Gmail', 'g1', '', index, interview_at=INVITE, now=NOW)
        mail.record(tracker, tracker.rows[0], 'Interview scheduled', '2026-09-30T09:00:00+00:00', 'Telegram', 'paste-9', '', index, interview_at=INVITE, now=NOW)
        self.assertEqual(tracker.kinds(), ['Interview scheduled'])

    def test_the_same_gmail_id_twice_is_one_event(self):
        tracker = Tracker(app())
        for _ in range(2):
            mail.record(tracker, tracker.rows[0], 'Interview scheduled', '2026-09-28T09:00:00+00:00', 'Gmail', 'g1', '', self.index(tracker),
                        interview_at=INVITE, now=NOW)
        self.assertEqual(tracker.kinds(), ['Interview scheduled'])
        first = ledger.add_event(tracker, tracker.rows[0], 'Reply received', 'Gmail', source_id='r1')
        again = ledger.add_event(tracker, tracker.rows[0], 'Reply received', 'Gmail', source_id='r1')
        other = ledger.add_event(tracker, tracker.rows[0], 'Reply received', 'Gmail', source_id='r2')
        self.assertTrue(again['_existing'] and again['id'] == first['id'])
        self.assertNotIn('_existing', other)
        self.assertEqual(tracker.kinds().count('Reply received'), 2)

    def test_a_stage_event_is_once_per_application(self):
        tracker = Tracker(app())
        for _ in range(2):
            ledger.add_event(tracker, tracker.rows[0], 'Screening', 'Job Pilotto app', note='Already talking to the recruiter when tracked')
        self.assertEqual(tracker.kinds(), ['Screening'])

    def test_moving_an_interview_from_focus_is_a_new_event(self):
        tracker = Tracker(app())
        self.gmail(tracker, 'g1')
        ledger.add_event(tracker, tracker.rows[0], 'Interview scheduled', 'Job Pilotto app', interview_at='2026-10-05T09:00:00+02:00')
        self.assertEqual(tracker.kinds(), ['Interview scheduled', 'Interview scheduled'])


CATCH_UP = 'Stage changed in Notion; time is when the row was last edited'


class CalendarSourceTests(unittest.TestCase):
    def test_a_calendar_invite_that_adopts_the_watchers_guess_says_it_came_from_the_calendar(self):
        tracker = Tracker(app('Interview scheduled'), [
            event('watch', 'Interview scheduled', '2026-09-30T06:00:00+00:00', 'Notion edit', note=CATCH_UP)])
        note = 'Calendar: Huxley · Principal SRE at Thu 01 Oct 08:30'
        mail.record(tracker, tracker.rows[0], 'Interview scheduled', '2026-09-30T07:17:00+00:00', 'Calendar', 'cal:_60q30c1g',
                    note, mail._events_index(tracker), '2026-10-01T08:30:00+02:00', NOW)
        props = tracker.events[0]['properties']
        self.assertEqual([e['id'] for e in tracker.events], ['watch'])  # adopted, not a second event
        self.assertEqual((ledger.plain(props['Source']), ledger.plain(props['Note']), ledger.plain(props['Source ID'])),
                         ('Calendar', note, 'cal:_60q30c1g'))

    def test_a_hand_logged_twin_keeps_its_own_source_and_note(self):
        tracker = Tracker(app('Interview scheduled'), [
            event('mine', 'Interview scheduled', '2026-09-30T06:00:00+00:00', 'Telegram', note='Logged: call with Anna')])
        mail.record(tracker, tracker.rows[0], 'Interview scheduled', '2026-09-30T07:17:00+00:00', 'Calendar', 'cal:y',
                    'Calendar: call', mail._events_index(tracker), '2026-10-01T08:30:00+02:00', NOW)
        props = tracker.events[0]['properties']
        self.assertEqual((ledger.plain(props['Source']), ledger.plain(props['Note'])), ('Telegram', 'Logged: call with Anna'))


def quiet(call, *args, **kwargs):
    with redirect_stderr(io.StringIO()):
        return call(*args, **kwargs)


class ImpossibleInterviewTests(unittest.TestCase):
    """The real case: a LinkedIn chat pasted in Telegram on 21 Sep 2026 whose "Sep 26" was read as 26 Sep 2024."""
    PASTED = '2026-09-21T14:36:00+00:00'
    MISREAD = '2024-09-26T08:30:00+02:00'

    def paste(self, tracker, index=None):
        return quiet(mail.record, tracker, tracker.rows[0], 'Interview scheduled', self.PASTED, 'Telegram',
                     'paste:147147426806328e', 'Logged: call with Anna', index or mail._events_index(tracker),
                     self.MISREAD, datetime(2026, 9, 21, 15, 0, tzinfo=timezone.utc))

    def test_a_paste_whose_interview_date_is_years_before_it_does_not_store_that_date(self):
        tracker = Tracker(app('Screening'))
        self.paste(tracker)
        self.assertEqual(tracker.kinds(), ['Interview scheduled'])  # the event is kept: an interview was scheduled
        self.assertEqual(ledger.event_interview_at(tracker.events[0]), '')
        self.assertNotIn('2024', str(tracker.events[0]['properties']))
        self.assertIsNone(tracker.rows[0]['properties']['Next interview']['date'])

    def test_the_real_invite_later_gives_that_event_its_time_instead_of_being_dropped(self):
        tracker = Tracker(app('Screening'))
        index = mail._events_index(tracker)
        self.paste(tracker, index)
        mail.record(tracker, tracker.rows[0], 'Interview scheduled', '2026-09-24T12:35:00+00:00', 'Gmail', 'g-invite', '',
                    index, '2026-09-30T10:30:00+04:00', datetime(2026, 9, 24, 13, 0, tzinfo=timezone.utc))
        self.assertEqual(tracker.kinds(), ['Interview scheduled'])
        self.assertEqual(ledger.event_interview_at(tracker.events[0]), '2026-09-30T10:30:00+04:00')
        self.assertTrue(tracker.rows[0]['properties']['Next interview']['date'])

    def test_add_event_never_stores_an_impossible_interview_time(self):
        tracker = Tracker(app())
        quiet(ledger.add_event, tracker, tracker.rows[0], 'Interview scheduled', 'Telegram', at=self.PASTED,
              interview_at=self.MISREAD)
        quiet(ledger.add_event, tracker, tracker.rows[0], 'Interview scheduled', 'Telegram', at=self.PASTED,
              interview_at='2028-09-26T08:30:00+02:00')  # over a year ahead: as impossible
        self.assertEqual([ledger.event_interview_at(e) for e in tracker.events], [''])

    def test_plausible_times_are_kept(self):
        for when in ('2026-09-26T08:30:00+02:00', '2026-09-10T08:30:00+02:00', '2027-03-01T09:00:00+01:00'):
            self.assertEqual(ledger.plausible_interview(when, self.PASTED), when)
        self.assertEqual(quiet(ledger.plausible_interview, self.MISREAD, self.PASTED), '')
        self.assertEqual(ledger.plausible_interview('not a date', self.PASTED), '')

    def test_the_apps_confirmation_step_asks_for_the_call_time_instead_of_showing_the_wrong_year(self):
        item = {'kind': 'Interview scheduled', 'interview_at': self.MISREAD, 'when': self.PASTED,
                'seen': {'interview': 'shown', 'year': 'shown', 'channel': 'shown'}, 'platform': 'LinkedIn'}
        shown = quiet(inbox.fields, item, 'Interview scheduled', new=False,
                      now=datetime(2026, 9, 21, 15, 0, tzinfo=timezone.utc))['interview']
        self.assertEqual((shown['value'], shown['state']), ('', 'ask'))


if __name__ == '__main__':
    unittest.main()

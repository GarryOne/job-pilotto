"""One 📈 Application Events row per real occurrence: add_event is idempotent, the stage watcher doesn't repeat
Job Pilotto's own events, and `--dedupe-events` tidies the repeats already in a workspace (the Huxley case)."""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail
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


class TidyTests(unittest.TestCase):
    def huxley(self):
        return Tracker(app('Interview scheduled'), [
            event('lead', 'Recruiter lead', '2026-09-24T09:00:00+00:00', source_id='g0'),
            event('screen', 'Screening', '2026-09-24T09:05:00+00:00', 'Job Pilotto app', note='Already talking to the recruiter when tracked'),
            event('gmail', 'Interview scheduled', '2026-09-28T09:00:00+00:00', source_id='1a0ed2a0b8f85171',
                  changes='{"fields": {}, "interview_at": "2026-10-02T14:00:00+02:00"}'),
            event('paste', 'Interview scheduled', '2026-09-30T08:00:00+00:00', 'Telegram', note='pasted LinkedIn chat'),
            event('watch', 'Interview scheduled', '2026-09-30T10:00:00+00:00', 'Notion edit',
                  note='Stage changed in Notion; time is when the row was last edited')])

    def test_dry_run_lists_exactly_the_duplicates_and_changes_nothing(self):
        tracker = self.huxley()
        lines = ledger.dedupe_events(tracker)
        self.assertEqual([e for e in lines if 'extra' in e or 'KEEP' in e].__len__(), 3)
        self.assertTrue(any('KEEP  gmail' in line for line in lines))
        self.assertTrue(any('extra paste' in line for line in lines) and any('extra watch' in line for line in lines))
        self.assertFalse(any(' lead ' in line or ' screen ' in line for line in lines))
        self.assertEqual((tracker.trashed, len(tracker.events)), ([], 5))

    def test_apply_trashes_only_the_extras(self):
        tracker = self.huxley()
        ledger.dedupe_events(tracker, apply=True)
        self.assertEqual(sorted(tracker.trashed), ['paste', 'watch'])
        self.assertEqual([e['id'] for e in tracker.events], ['lead', 'screen', 'gmail'])
        self.assertEqual(ledger.dedupe_events(tracker), ['No duplicate events.'])

    def test_two_interview_times_and_two_replies_are_not_duplicates(self):
        tracker = Tracker(app(), [
            event('a', 'Interview scheduled', '2026-09-28T09:00:00+00:00', source_id='g1', changes='{"interview_at": "2026-10-02T14:00:00+02:00"}'),
            event('b', 'Interview scheduled', '2026-09-29T09:00:00+00:00', source_id='g2', changes='{"interview_at": "2026-10-09T14:00:00+02:00"}'),
            event('c', 'Reply received', '2026-09-28T09:00:00+00:00', source_id='r1'),
            event('d', 'Reply received', '2026-09-28T10:00:00+00:00', source_id='r2')])
        self.assertEqual(ledger.dedupe_events(tracker), ['No duplicate events.'])

    def test_the_same_source_id_twice_is_one_event(self):
        tracker = Tracker(app(), [event('a', 'Reply received', '2026-09-28T09:00:00+00:00', source_id='r1'),
                                  event('b', 'Reply received', '2026-09-28T09:00:01+00:00', source_id='r1')])
        ledger.dedupe_events(tracker, apply=True)
        self.assertEqual(tracker.trashed, ['b'])


if __name__ == '__main__':
    unittest.main()

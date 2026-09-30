"""Duplicate 📈 Application Events are tidied automatically (ledger.heal): at the end of every job that writes events,
only certain duplicates, each removal listed. The real Huxley case: a pasted message read with the wrong year."""
import io
import sys
import unittest
from contextlib import redirect_stderr
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail
from src.notion import cron_runs, ledger
from tests.test_event_dedupe import Tracker, app, event, NOW

CATCH_UP = 'Stage changed in Notion; time is when the row was last edited'
JUNK_REASON = 'interview date 2024-09-26 is long before it was logged'


def interview(page_id, at, source, source_id, when, note=''):
    return event(page_id, 'Interview scheduled', at, source, source_id=source_id, note=note,
                 changes=f'{{"fields": {{}}, "interview_at": "{when}"}}')


def huxley():
    """The owner's six events, as they are in Notion."""
    return Tracker(app('Interview scheduled'), [
        event('lead', 'Recruiter lead', '2026-09-24T09:00:00+00:00', source_id='1a0ed2a0b8f85171'),
        event('screen', 'Screening', '2026-09-24T09:05:00+00:00', 'Job Pilotto app', note='Already talking to the recruiter when tracked'),
        interview('gmail', '2026-09-29T12:35:00+00:00', 'Gmail', '1a0ed2a0b8f85171', '2026-09-30T10:30:00+04:00'),
        interview('paste', '2026-09-21T14:36:00+00:00', 'Telegram', 'paste:147147426806328e', '2024-09-26T08:30:00+02:00'),
        interview('cal', '2026-09-30T07:17:00+00:00', 'Notion edit', 'cal:_60q30c1g', '2026-10-01T08:30:00+02:00', CATCH_UP),
        event('reply', 'Reply received', '2026-09-30T06:00:00+00:00', source_id='1a0f12c88badf86c')])


def quiet(call, *args, **kwargs):
    with redirect_stderr(io.StringIO()):
        return call(*args, **kwargs)


class HuxleyTests(unittest.TestCase):
    def setUp(self):
        cron_runs.TIDIED.clear()

    def test_the_dry_run_lists_the_misread_interview_with_its_reason(self):
        tracker = huxley()
        lines = ledger.dedupe_events(tracker)
        listed = [line for line in lines if 'KEEP' in line or 'extra' in line]
        self.assertEqual(len(listed), 2)
        self.assertTrue(any(line.lstrip().startswith('KEEP  gmail') for line in listed))
        extra = next(line for line in listed if 'extra paste' in line)
        self.assertIn(f'({JUNK_REASON})', extra)
        self.assertEqual(lines[0], 'Huxley — Principal SRE: Interview scheduled x2')
        self.assertFalse(any(f' {name} ' in line for line in lines for name in ('cal', 'lead', 'screen', 'reply')))
        self.assertEqual(lines[-1], '1 duplicate event(s) would be moved to the Notion trash (run with --apply); 1 group(s).')
        self.assertEqual(tracker.trashed, [])

    def test_the_automatic_tidy_removes_exactly_the_junk_event_once(self):
        tracker = huxley()
        lines = quiet(ledger.heal, tracker)
        self.assertEqual(lines, ['Removed 1 duplicate event on Principal SRE at Huxley: Interview scheduled (date looked wrong)'])
        self.assertEqual(tracker.trashed, ['paste'])
        self.assertEqual(cron_runs.TIDIED, lines)  # the run's ⏱️ Search runs report lists it
        self.assertEqual(quiet(ledger.heal, tracker), [])  # again: nothing more
        self.assertEqual(tracker.trashed, ['paste'])
        self.assertEqual(ledger.dedupe_events(tracker), ['No duplicate events.'])

    def test_the_end_of_a_job_tidies_the_applications_it_wrote_to(self):
        tracker = huxley()
        ledger.add_event(tracker, tracker.rows[0], 'Reply received', 'Gmail', source_id='new-reply')
        self.assertEqual(len(quiet(ledger.heal_touched, tracker)), 1)
        self.assertEqual(tracker.trashed, ['paste'])
        self.assertEqual(quiet(ledger.heal_touched, tracker), [])  # nothing written since: nothing to do

    def test_a_job_that_logs_its_run_lists_the_removal_in_the_report(self):
        tracker = huxley()
        ledger.add_event(tracker, tracker.rows[0], 'Reply received', 'Gmail', source_id='new-reply')
        sent = []
        tracker._request = lambda method, path, body=None: sent.append((method, path, body)) or {'id': 'run', 'url': 'u'}
        run = cron_runs.new_run('mail')
        quiet(cron_runs.log_run, tracker, run)
        self.assertEqual(tracker.trashed, ['paste'])
        page = next(body for method, path, body in sent if method == 'POST')
        report = [b['bulleted_list_item']['rich_text'][0]['text']['content'] for b in page['children'] if b['type'] == 'bulleted_list_item']
        self.assertIn('Removed 1 duplicate event on Principal SRE at Huxley: Interview scheduled (date looked wrong)', report)

    def test_a_failing_tidy_never_fails_the_job(self):
        tracker = huxley()
        ledger.add_event(tracker, tracker.rows[0], 'Reply received', 'Gmail', source_id='new-reply')
        tracker.trash_page = lambda page_id: (_ for _ in ()).throw(RuntimeError('Notion is down'))
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(ledger.heal_touched(tracker), [])
        self.assertIn('duplicate events not tidied: RuntimeError', err.getvalue())


class LeftAloneTests(unittest.TestCase):
    def test_the_only_interview_with_a_wrong_date_is_reported_never_removed(self):
        tracker = Tracker(app('Interview scheduled'), [
            interview('paste', '2026-09-21T14:36:00+00:00', 'Telegram', 'paste:1', '2024-09-26T08:30:00+02:00'),
            event('screen', 'Screening', '2026-09-20T09:05:00+00:00', 'Job Pilotto app')])
        lines = ledger.dedupe_events(tracker, apply=True)
        self.assertIn(f'Huxley — Principal SRE: Interview scheduled paste: date looks wrong ({JUNK_REASON}); '
                      'kept, as the only interview time', lines)
        self.assertEqual(lines[-1], 'No duplicate events.')
        self.assertEqual(quiet(ledger.heal, tracker), [])
        self.assertEqual(tracker.trashed, [])

    def test_two_real_interviews_at_different_times_are_both_kept(self):
        tracker = Tracker(app('Interview scheduled'), [
            interview('gmail', '2026-09-29T12:35:00+00:00', 'Gmail', 'g1', '2026-09-30T10:30:00+04:00'),
            interview('cal', '2026-09-30T07:17:00+00:00', 'Calendar', 'cal:x', '2026-10-01T08:30:00+02:00')])
        self.assertEqual(ledger.dedupe_events(tracker), ['No duplicate events.'])
        self.assertEqual(quiet(ledger.heal, tracker), [])

    def test_a_same_day_guess_is_listed_but_not_removed_automatically(self):
        tracker = Tracker(app(), [event('a', 'Reply received', '2026-09-28T09:00:00+00:00', source_id='r1'),
                                  event('b', 'Reply received', '2026-09-28T15:00:00+00:00', 'Telegram')])
        self.assertIn('(a guess: the automatic tidy leaves it)', ledger.dedupe_events(tracker)[0])
        self.assertEqual(quiet(ledger.heal, tracker), [])
        self.assertEqual(tracker.trashed, [])

    def test_an_event_edited_by_hand_is_not_removed_automatically(self):
        edited = event('hand', 'Screening', '2026-09-25T09:00:00+00:00', 'Notion edit', note='Call with Anna, went well')
        edited.update(created_time='2026-09-25T09:00:00.000Z', last_edited_time='2026-09-26T18:00:00.000Z')
        tracker = Tracker(app(), [event('real', 'Screening', '2026-09-24T09:00:00+00:00', source_id='g1'), edited])
        self.assertEqual(quiet(ledger.heal, tracker), [])
        self.assertEqual(tracker.trashed, [])

    def test_the_same_source_id_twice_is_removed_automatically(self):
        tracker = Tracker(app(), [event('a', 'Reply received', '2026-09-28T09:00:00+00:00', source_id='r1'),
                                  event('b', 'Reply received', '2026-09-28T09:00:01+00:00', source_id='r1')])
        self.assertEqual(quiet(ledger.heal, tracker), ['Removed 1 duplicate event on Principal SRE at Huxley: Reply received (logged twice)'])
        self.assertEqual(tracker.trashed, ['b'])


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


if __name__ == '__main__':
    unittest.main()

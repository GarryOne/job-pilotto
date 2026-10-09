"""A chat whose last message is a scheduling link (Calendly, Cal.com…): the link is saved in the event's note, so Focus shows
"Book the call" with a button that opens it (src/focus.py _booking_link), instead of "Reply … Open email"."""
import unittest

from src.ai import inbox
from tests.test_inbox import SHOT, job, reading, row, run
from tests.mail_fakes import stores_for
from tests.test_inbox import Inbox

LINK = 'https://calendly.com/discussion_meeting/meeting'


def notes(tracker):
    return [((page.get('Note') or {}).get('rich_text') or [{}])[0].get('text', {}).get('content', '') for page in tracker.created]


def tracked():
    return Inbox([row('p1', 'https://x.test/1', 'Senior Web3 Infrastructure / DevOps Engineer', 'Blockdaemon', 'Screening')],
                 [job('https://x.test/1', 'Senior Web3 Infrastructure / DevOps Engineer', 'Blockdaemon', 'Screening')])


class BookingLinkTests(unittest.TestCase):
    def test_a_reply_with_a_booking_link_keeps_it_in_the_events_note(self):
        tracker = tracked()
        run(tracker, reading('Reply received', 0, summary='Asked you to book a call', booking_link=LINK))
        self.assertTrue(any(f'Booking link: {LINK}' in note for note in notes(tracker)), notes(tracker))

    def test_the_last_message_event_carries_it_too(self):
        # "Update on this job": nothing new of its own kind, but their last message is the booking link.
        tracker = tracked()
        last = {'from': 'them', 'at': '2026-09-30T12:33:00+00:00', 'at_text': 'TODAY 12:33 PM', 'text_snippet': 'Thank you. https://calendly.com/…'}
        inbox.log(stores_for(tracker), image=SHOT, client=__import__('tests.test_opportunity', fromlist=['Client']).Client(
            reading(inbox.UPDATE, 0, booking_link=LINK, last_message=last, when='2026-09-30T12:33:00+00:00')), now=inbox.datetime(2026, 9, 30, 13, 0, tzinfo=inbox.timezone.utc))
        self.assertTrue(any(f'Booking link: {LINK}' in note for note in notes(tracker)), notes(tracker))

    def test_no_link_no_suffix_and_only_a_web_address_counts(self):
        tracker = tracked()
        run(tracker, reading('Reply received', 0, summary='Asked you to book a call', booking_link=''))
        self.assertFalse(any('Booking link' in note for note in notes(tracker)))
        odd = tracked()
        run(odd, reading('Reply received', 0, summary='Asked you to book a call', booking_link='javascript:alert(1)'))
        self.assertFalse(any('Booking link' in note for note in odd and notes(odd)))

    def test_the_reading_is_asked_for_the_link(self):
        self.assertIn('booking_link', inbox.SCHEMA['properties'])
        self.assertIn('booking_link', inbox.SCHEMA['required'])


class RunTracker(Inbox):
    """Records what is written to the run's row (PATCH blocks/<run>/children)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.run_blocks = []

    def _request(self, method, path, body=None):
        if method == 'PATCH' and path.startswith('blocks/run-1/children'):
            self.run_blocks += body['children']
            return {}
        if path.split('/')[0] in ('pages', 'databases', 'blocks'):  # the store reads rows and the schema, writes sections
            return super()._request(method, path, body)
        return {}


def images(blocks):
    found = []
    for block in blocks:
        if block['type'] == 'image':
            found.append(block)
        for holder in ('toggle', 'column_list', 'column'):
            found += images((block.get(holder) or {}).get('children', []) if holder in block else [])
    return found


class ScreenshotsGoToTheRunTests(unittest.TestCase):
    def setUp(self):
        from src.notion import cron_runs
        self.cron_runs = cron_runs
        self.saved = dict(cron_runs._open)

    def tearDown(self):
        self.cron_runs._open.clear()
        self.cron_runs._open.update(self.saved)

    def test_the_screenshot_is_kept_on_the_logged_activity_run_not_on_the_job(self):
        tracker = RunTracker([row('p1', 'https://x.test/1', 'SRE', 'Blockdaemon', 'Screening')], [job('https://x.test/1', 'SRE', 'Blockdaemon', 'Screening')])
        self.cron_runs._open.clear()
        self.cron_runs._open.update(tracker=tracker, id='run-1', url='https://notion.test/run-1', run={})
        run(tracker, reading('Reply received', 0, summary='Asked you to book a call'))
        self.assertEqual(len(images(tracker.run_blocks)), 1)  # on the run's row
        entry = tracker.appended[0][1][-1]['toggle']['children']
        self.assertEqual(images(entry), [])  # not on the job's page
        said = [part['paragraph']['rich_text'][0] for part in entry if part['type'] == 'paragraph']
        self.assertTrue(any('run-1' in (part.get('text', {}).get('link') or {}).get('url', '') for part in said), said)  # a link to it

    def test_a_new_leads_page_does_not_get_the_screenshots_either(self):
        tracker = RunTracker()
        self.cron_runs._open.clear()
        self.cron_runs._open.update(tracker=tracker, id='run-1', url='https://notion.test/run-1', run={})
        run(tracker, reading('Recruiter outreach', -1, role='Senior Web3 Infrastructure Engineer', summary='Web3 platform, remote',
                             is_opportunity=True, title='Senior Web3 Infrastructure Engineer', recruiter_name='Linomica Irigoyen'))
        self.assertEqual(len(images(tracker.run_blocks)), 1)
        page_blocks = [block for blocks in tracker.blocks.values() for block in blocks]  # the new lead's page
        self.assertEqual(images(page_blocks), [])
        self.assertIn('run-1', str(page_blocks))  # the page says where they are

    def test_without_an_open_run_the_screenshot_stays_on_the_job(self):
        tracker = RunTracker([row('p1', 'https://x.test/1', 'SRE', 'Blockdaemon', 'Screening')], [job('https://x.test/1', 'SRE', 'Blockdaemon', 'Screening')])
        self.cron_runs._open.clear()
        run(tracker, reading('Reply received', 0, summary='Asked you to book a call'))
        self.assertEqual(tracker.run_blocks, [])
        self.assertEqual(len(images(tracker.appended[0][1][-1]['toggle']['children'])), 1)


class SmallCopyTests(unittest.TestCase):
    """The app writes a small copy beside each pasted screenshot (desktop/lib/shots.js): Claude reads the original,
    Notion gets the small one (a few dozen KB instead of a full-size PNG)."""

    def test_a_small_copy_beside_the_file_is_the_one_uploaded(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'shot.png').write_bytes(b'FULL-SIZE-PNG')
            (Path(folder) / 'shot.png.small.jpg').write_bytes(b'small-jpeg')
            shot = inbox.load_image(str(Path(folder) / 'shot.png'))
        self.assertEqual(shot[:3], ('shot.png', b'FULL-SIZE-PNG', 'image/png'))  # what Claude reads
        tracker = Inbox()
        inbox._image_blocks(tracker, shot)
        self.assertEqual(tracker.uploads, ['shot.png.small.jpg'])

    def test_without_a_small_copy_the_original_is_uploaded_as_before(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'shot.png').write_bytes(b'FULL-SIZE-PNG')
            shot = inbox.load_image(str(Path(folder) / 'shot.png'))
        self.assertEqual(len(shot), 3)
        tracker = Inbox()
        inbox._image_blocks(tracker, shot)
        self.assertEqual(tracker.uploads, ['shot.png'])


if __name__ == '__main__':
    unittest.main()

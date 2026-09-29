"""An emailed invitation's start comes from its calendar part, in the right time zone."""
import base64
import unittest

from src.sources import google

ICS = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Connect Igor / Jaya - SRE\r\n"
       "DTSTART;TZID=Arabian Standard Time:20260930T103000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")


def part(mime, text):
    return {'mimeType': mime, 'body': {'data': base64.urlsafe_b64encode(text.encode()).decode()}}


class InviteTest(unittest.TestCase):
    def test_start_from_the_calendar_part(self):
        payload = {'mimeType': 'multipart/mixed', 'parts': [part('text/plain', 'Microsoft Teams meeting'), part('text/calendar', ICS)]}
        self.assertEqual(google.invite_start(google.calendar_text(payload)), '2026-09-30T10:30:00+04:00')  # 08:30 in Zurich

    def test_utc_and_attachments(self):
        self.assertEqual(google.invite_start('BEGIN:VEVENT\nDTSTART:20260930T063000Z\n'), '2026-09-30T06:30:00+00:00')
        payload = {'parts': [{'filename': 'invite.ics', 'mimeType': 'application/ics', 'body': {'attachmentId': 'a1'}}]}
        fetched = lambda attachment: {'data': base64.urlsafe_b64encode(ICS.encode()).decode()}
        self.assertIn('DTSTART', google.calendar_text(payload, fetched))

    def test_no_invitation(self):
        self.assertEqual(google.calendar_text({'mimeType': 'text/plain', 'body': {'data': ''}}), '')
        self.assertIsNone(google.invite_start('BEGIN:VEVENT\nSUMMARY:x\n'))


if __name__ == '__main__':
    unittest.main()

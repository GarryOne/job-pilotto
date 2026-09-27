import unittest
from datetime import datetime, timedelta, timezone

from src.sources import google


def email(subject, body, minutes_ago=1, sender='noreply@careers.example.org'):
    at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    return {'id': subject, 'from': sender, 'to': '', 'subject': subject, 'date': at, 'body': body}


class FakeGoogle:
    def __init__(self, batches):
        self.batches, self.queries = list(batches), []

    def search(self, query, limit=50):
        self.queries.append(query)
        self.current = self.batches.pop(0) if self.batches else []
        return [m['id'] for m in self.current]

    def message(self, message_id):
        return next(m for m in self.current if m['id'] == message_id)


class ConfirmationTests(unittest.TestCase):
    def test_code_next_to_its_label_not_other_numbers(self):
        found = google.confirmation(email('Your account', 'Ref 2166 posted 2026.\nYour verification code is 483920. It expires in 10 minutes.'))
        self.assertEqual(found['code'], '483920')

    def test_confirm_link_kept_other_links_dropped(self):
        body = 'Welcome! Activate: https://careers.example.org/verify?token=abc123.\nhttps://example.org/privacy'
        found = google.confirmation(email('Activate your account', body))
        self.assertEqual(found['links'], ['https://careers.example.org/verify?token=abc123'])
        self.assertEqual(found['code'], '')

    def test_waits_for_the_email_and_skips_old_ones(self):
        fake = FakeGoogle([[], [email('Old code', 'Your code: 111111', minutes_ago=60)],
                           [email('New code', 'Your code: 222222')]])
        naps = []
        found = google.wait_for_confirmation(fake, 'careers.example.org', minutes=15, wait=30, every=10, sleep=naps.append)
        self.assertEqual(found['code'], '222222')
        self.assertEqual(naps, [10, 10])
        self.assertIn('from:careers.example.org', fake.queries[0])

    def test_nothing_arrives(self):
        self.assertIsNone(google.wait_for_confirmation(FakeGoogle([]), wait=20, every=10, sleep=lambda _: None))


if __name__ == '__main__':
    unittest.main()

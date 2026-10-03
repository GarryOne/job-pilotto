import os
import sys
import unittest
from unittest import mock

from src import secret_store
from src.ai import passwords
from src.sources import google


class FakeKeyring:
    def __init__(self):
        self.items = {}

    def get_password(self, service, user):
        return self.items.get((service, user))

    def set_password(self, service, user, value):
        self.items[(service, user)] = value

    def delete_password(self, service, user):
        self.items.pop((service, user))


class SecretStoreTest(unittest.TestCase):
    def test_windows_uses_the_credential_manager_through_keyring(self):
        store = FakeKeyring()
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(secret_store, '_keyring', return_value=store):
            secret_store.put('job-pilotto.google.refresh-token', 'r1', 'igor')
            self.assertEqual(secret_store.get('job-pilotto.google.refresh-token', 'igor'), 'r1')
            secret_store.delete('job-pilotto.google.refresh-token', 'igor')
            secret_store.delete('job-pilotto.google.refresh-token', 'igor')  # already gone: no error
            self.assertIsNone(secret_store.get('job-pilotto.google.refresh-token', 'igor'))

    def test_the_mac_keeps_its_keychain_items(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return mock.Mock(returncode=0, stdout='secret\n')
        with mock.patch.object(sys, 'platform', 'darwin'), mock.patch.object(secret_store.subprocess, 'run', run):
            self.assertEqual(secret_store.get('job-pilotto.x.password', 'job-pilotto'), 'secret')
            secret_store.put('job-pilotto.x.password', 'pw', 'job-pilotto', label='Job Pilotto: x')
        self.assertEqual(calls[0], ['security', 'find-generic-password', '-a', 'job-pilotto', '-s', 'job-pilotto.x.password', '-w'])
        self.assertEqual(calls[1], ['security', 'add-generic-password', '-U', '-a', 'job-pilotto', '-s', 'job-pilotto.x.password',
                                    '-l', 'Job Pilotto: x', '-w', 'pw'])

    def test_no_store_elsewhere_reads_nothing(self):
        with mock.patch.object(sys, 'platform', 'linux'):
            self.assertIsNone(secret_store.get('anything'))
            with self.assertRaises(SystemExit):
                secret_store.put('anything', 'x')

    def test_google_sign_in_is_stored_through_it(self):
        store = FakeKeyring()
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(secret_store, '_keyring', return_value=store), \
                mock.patch.dict('os.environ', {'USER': 'igor'}):
            google.store('id', 'secret', 'refresh', production=False, github=False)
            self.assertEqual(google.credentials(), ('id', 'secret', 'refresh'))
        self.assertIn(('job-pilotto.google.auth-at', 'igor'), store.items)


class EndToEndIsolationTest(unittest.TestCase):
    """The end-to-end test app runs on the owner's own Mac: the Keychain there holds the owner's real Google sign-in and Telegram bot (2 Oct 2026: a test
    "Gmail check" read the owner's real mail). With JOB_PILOTTO_E2E set the engine sees no Keychain at all."""

    def _keychain_answers(self):
        return mock.patch.object(secret_store.subprocess, 'run', return_value=mock.Mock(returncode=0, stdout='real-secret\n'))

    def test_the_keychain_is_not_read(self):
        with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers() as asked, mock.patch.dict('os.environ', {'JOB_PILOTTO_E2E': '1'}):
            self.assertIsNone(secret_store.get('job-pilotto.google.refresh-token', 'igor'))
        asked.assert_not_called()

    def test_without_the_flag_the_keychain_is_read_as_before(self):
        with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers(), mock.patch.dict('os.environ'):
            os.environ.pop('JOB_PILOTTO_E2E', None)
            self.assertEqual(secret_store.get('job-pilotto.google.refresh-token', 'igor'), 'real-secret')

    def test_google_is_not_connected_and_telegram_has_no_token(self):
        from src import telegram
        env = {'JOB_PILOTTO_E2E': '1'}
        with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers(), mock.patch.dict('os.environ', env), \
                mock.patch('src.sources.google.os.getenv', side_effect=lambda name, default=None: {'JOB_PILOTTO_E2E': '1'}.get(name, default)):
            self.assertIsNone(google.credentials())
        with mock.patch.object(sys, 'platform', 'darwin'), mock.patch.object(telegram.subprocess, 'run',
                return_value=mock.Mock(stdout='123456:real-bot-token\n')) as asked, mock.patch.dict('os.environ', env):
            self.assertIsNone(telegram.keychain_token())
        asked.assert_not_called()

    def test_telegram_keychain_token_does_not_need_os_uname_which_windows_lacks(self):
        from src import telegram
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(telegram.os, 'uname', side_effect=AttributeError("module 'os' has no attribute 'uname'"), create=True), \
                mock.patch.object(telegram.subprocess, 'run') as asked, mock.patch.dict('os.environ'):
            os.environ.pop('JOB_PILOTTO_E2E', None)
            self.assertIsNone(telegram.keychain_token())
        asked.assert_not_called()

    def test_the_admin_key_and_the_notion_fallback_do_not_read_the_keychain_either(self):
        from src.ai import apply_run, budget
        env = {'JOB_PILOTTO_E2E': '1'}
        with mock.patch.object(sys, 'platform', 'darwin'), mock.patch.dict('os.environ', env), mock.patch.object(budget.subprocess, 'run') as budget_asked, \
                mock.patch.object(apply_run.subprocess, 'run') as apply_asked, mock.patch.object(apply_run.Tracker, 'from_env', return_value=None):
            os.environ.pop('ANTHROPIC_ADMIN_KEY', None)
            self.assertIsNone(budget.admin_key())
            self.assertIsNone(apply_run._tracker())
        budget_asked.assert_not_called()
        apply_asked.assert_not_called()


class PasswordsTest(unittest.TestCase):
    def test_generated_passwords_have_every_class_or_none_of_the_refused_symbols(self):
        for _ in range(50):
            password = passwords.generate()
            self.assertEqual(len(password), 16)
            self.assertTrue(any(c.islower() for c in password) and any(c.isupper() for c in password))
            self.assertTrue(any(c.isdigit() for c in password) and any(not c.isalnum() for c in password))
            self.assertTrue(passwords.generate(12, '').isalnum())

    def test_new_stores_and_copies_without_printing_the_password(self):
        store, copied = FakeKeyring(), []
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(secret_store, '_keyring', return_value=store), \
                mock.patch.object(passwords, 'copy', copied.append), mock.patch('builtins.print') as printed:
            self.assertEqual(passwords.main(['have', 'careers.example.com']), 1)
            self.assertEqual(passwords.main(['new', 'careers.example.com']), 0)
            self.assertEqual(passwords.main(['have', 'careers.example.com']), 0)
            self.assertEqual(passwords.main(['copy', 'careers.example.com']), 0)
            self.assertEqual(passwords.main(['clear']), 0)
        stored = store.items[('job-pilotto.careers.example.com.password', 'job-pilotto')]
        self.assertEqual(copied, [stored, stored, ''])
        self.assertNotIn(stored, str(printed.call_args_list))


if __name__ == '__main__':
    unittest.main()

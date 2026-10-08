"""This computer's own secret store: the macOS Keychain (the `security` tool) or, on Windows, the
Credential Manager (through `keyring`, bundled with the Windows app). Elsewhere (CI, Linux) there is none:
reads return None and writes raise, so callers fall back to the environment."""
import getpass
import os
import subprocess
import sys


def account():
    """The account name secrets are stored under: the login name, as the Keychain items always had."""
    return os.getenv('USER') or getpass.getuser()


def _keyring():
    if sys.platform != 'win32':
        return None
    try:
        import keyring
    except ImportError:
        return None
    return keyring


def isolated():
    """True in the end-to-end journey (the app sets JOB_PILOTTO_E2E) and in a live-test twin (JOB_PILOTTO_TWIN, desktop/lib/twin.js): both run on
    the owner's own Mac, whose store holds their real Google sign-in and Telegram bot, so they see none."""
    return bool(os.getenv('JOB_PILOTTO_E2E') or os.getenv('JOB_PILOTTO_TWIN'))


def get(service, user=None):
    if isolated():
        return None
    user = account() if user is None else user
    if sys.platform == 'darwin':
        result = subprocess.run(['security', 'find-generic-password', '-a', user, '-s', service, '-w'],
                                capture_output=True, text=True)
        return (result.stdout.strip() or None) if result.returncode == 0 else None
    store = _keyring()
    return (store.get_password(service, user) or None) if store else None


def put(service, value, user=None, label=None, comment=None):
    """comment: what the item is for, kept beside it (Keychain only; never a secret)."""
    user = account() if user is None else user
    if sys.platform == 'darwin':
        subprocess.run(['security', 'add-generic-password', '-U', '-a', user, '-s', service,
                        *(['-l', label] if label else []), *(['-j', comment] if comment else []), '-w', value], check=True)
        return
    store = _keyring()
    if not store:
        raise SystemExit('No secret store on this computer (macOS Keychain or Windows Credential Manager).')
    store.set_password(service, user, value)


def delete(service, user=None):
    user = account() if user is None else user
    if sys.platform == 'darwin':
        subprocess.run(['security', 'delete-generic-password', '-a', user, '-s', service], capture_output=True)
        return
    store = _keyring()
    if store:
        try:
            store.delete_password(service, user)
        except Exception:  # keyring.errors.PasswordDeleteError: nothing stored
            pass

"""This computer's own secret store: the macOS Keychain (the `security` tool) or, on Windows, the
Credential Manager (through `keyring`, bundled with the Windows app). Elsewhere (CI, Linux) there is none:
reads return None and writes raise, so callers fall back to the environment.

A test run (JOB_PILOTTO_E2E) or a live-test twin (JOB_PILOTTO_TWIN) never reads or writes the real store: what it saves goes to the
run's own file (JOB_PILOTTO_ISOLATED_SECRETS, set by the app: desktop/lib/keychain.js), and reads see only that file. 8 Oct 2026: reads
were isolated but writes were not, so a local e2e run made a "new" job-site password and overwrote the owner's real one."""
import getpass
import json
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


def _isolated_items():
    path = os.getenv('JOB_PILOTTO_ISOLATED_SECRETS')
    if not path:
        return path, {}
    try:
        with open(path, encoding='utf-8') as handle:
            return path, json.load(handle) or {}
    except (OSError, ValueError):
        return path, {}


def _isolated_save(path, items):
    if not path:
        return  # an isolated run without its own file keeps nothing, and never the real store
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(items, handle)


# What a live-test twin may READ from the owner's real store (owner, 10 Oct 2026: "let the twin use the original app Gmail connection"): the Google
# sign-in (read-only Gmail and Calendar), so the sign-up's confirmation mail can be found. Nothing else, and never a write (put/delete stay in the twin's file).
TWIN_MAY_READ = ('job-pilotto.google.client-id', 'job-pilotto.google.client-secret', 'job-pilotto.google.refresh-token')


def _twin_may_read(service):
    return bool(os.getenv('JOB_PILOTTO_TWIN')) and not os.getenv('JOB_PILOTTO_E2E') and service in TWIN_MAY_READ


def get(service, user=None):
    if isolated():
        own = (_isolated_items()[1].get(service) or {}).get('value') or None
        if own or not _twin_may_read(service):
            return own
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
    if isolated():
        from datetime import datetime, timezone
        path, items = _isolated_items()
        items[service] = {'value': value, 'account': user, 'comment': comment or '', 'created': datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}
        _isolated_save(path, items)
        return
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
    if isolated():
        path, items = _isolated_items()
        if items.pop(service, None) is not None:
            _isolated_save(path, items)
        return
    if sys.platform == 'darwin':
        subprocess.run(['security', 'delete-generic-password', '-a', user, '-s', service], capture_output=True)
        return
    store = _keyring()
    if store:
        try:
            store.delete_password(service, user)
        except Exception:  # keyring.errors.PasswordDeleteError: nothing stored
            pass

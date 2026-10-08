"""Employer-site passwords for Apply with Claude sessions, on the Mac and on Windows.

The session never sees or types a password: `new` stores one in this computer's secret store
(Keychain / Credential Manager, item job-pilotto.<host>.password) and puts it on the clipboard, the
session pastes it (cmd+v / ctrl+v), then `clear` empties the clipboard.

Every site gets the user's one job-site password (owner, 8 Oct 2026: one they can remember and type, e.g.
Maple-Rocket-42), made once and kept as job-pilotto.sites.password; Settings → Application assistant shows it.
Only a site whose rule it breaks (--length shorter, --no-symbols) gets a random one of its own.

  python3 -m src.ai.passwords have <host>    exit 0 when one is stored for that site
  python3 -m src.ai.passwords new <host>     the job-site password (or, for the rule a site shows,
      [--length N] [--no-symbols]            a random one), stored for that site and copied;
      [--email E] [--job URL]                the email the account uses and the job it was made for,
                                             kept with it for Settings → Credentials
  python3 -m src.ai.passwords copy <host>    copy the stored one
  python3 -m src.ai.passwords shared         make the job-site password if there is none, and copy it
  python3 -m src.ai.passwords clear          empty the clipboard
"""
import argparse
import secrets
import string
import subprocess
import sys

from .. import secret_store

ACCOUNT = 'job-pilotto'


SHARED = 'job-pilotto.sites.password'

# Short, plain words (4-6 letters) that are easy to say and type on any layout: no y or z, which QWERTZ swaps.
WORDS = ('amber apple arrow basil beach blue bread brick cedar chalk cloud coast comet coral cotton crane '
         'delta eagle ember fable falcon fern field flame flint frost garden giant ginger glass grape green harbor '
         'hazel island jade kite lemon light lilac lotus maple marble meadow melon mint moon north '
         'ocean olive orange orbit otter panda paper peach pearl pepper piano pilot pine planet plum polar pond prism '
         'rain raven river robin rocket rose salt sand silver smile snow solar spark spring star stone storm sugar '
         'tiger toast tulip velvet violet water whale wind winter wolf').split()


def service(host):
    return f'job-pilotto.{host}.password'


def memorable():
    """Two capitalised words and two digits, joined by hyphens: Maple-Rocket-42. 14-16 characters (12-14 without the
    hyphens), with upper, lower, digit and a symbol, which most sign-up rules ask for."""
    first = secrets.choice(WORDS)
    # 10-12 letters in all: at least 12 characters even without its hyphens (Migros's SuccessFactors wants 12-18, no symbols), at most 16 with them.
    second = secrets.choice([word for word in WORDS if word != first and 10 <= len(first) + len(word) <= 12])
    return f'{first.capitalize()}-{second.capitalize()}-{secrets.randbelow(90) + 10}'


def shared_password():
    """The user's job-site password, made the first time it is needed."""
    password = secret_store.get(SHARED, ACCOUNT)
    if password is None:
        password = memorable()
        secret_store.put(SHARED, password, ACCOUNT, label='Job Pilotto: job-site password')
    return password


def note(email='', job=''):
    """What Settings → Credentials shows beside a site's password: 'email=<email> job=<url>' (no spaces inside either)."""
    parts = [f'{key}={value.strip()}' for key, value in (('email', email), ('job', job)) if value and value.strip() and ' ' not in value.strip()]
    return ' '.join(parts) or None


def for_site(length=None, symbols=True):
    """The job-site password, fitted to a site's rule: without its hyphens when symbols are refused; a random one when
    the site wants it shorter."""
    password = shared_password()
    if not symbols:
        password = password.replace('-', '')
    if length and len(password) > length:
        return generate(max(8, length), '!#%+-=?@_' if symbols else '')
    return password


def generate(length=16, symbols='!#%+-=?@_'):
    """Letters, digits and symbols, at least one of each: sign-up forms usually want every class and
    often cap the length at 16-20. symbols='' for a site that refuses them."""
    alphabet = string.ascii_letters + string.digits + symbols
    while True:
        password = ''.join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.islower() for c in password) and any(c.isupper() for c in password)
                and any(c.isdigit() for c in password) and (not symbols or any(c in symbols for c in password))):
            return password


def copy(text):
    if sys.platform == 'darwin':
        subprocess.run(['pbcopy'], input=text, text=True, check=True)
    elif sys.platform == 'win32':
        if text:
            subprocess.run(['clip'], input=text, text=True, check=True)
        else:
            import ctypes
            user32 = ctypes.windll.user32
            if user32.OpenClipboard(None):
                user32.EmptyClipboard()
                user32.CloseClipboard()
    else:
        raise SystemExit('No clipboard helper on this system.')


def main(argv=None):
    parser = argparse.ArgumentParser(prog='python3 -m src.ai.passwords', description=__doc__.split('\n')[0])
    parser.add_argument('action', choices=['have', 'new', 'copy', 'shared', 'clear'])
    parser.add_argument('host', nargs='?')
    parser.add_argument('--length', type=int, default=None)
    parser.add_argument('--no-symbols', action='store_true')
    parser.add_argument('--email', default='')
    parser.add_argument('--job', default='')
    args = parser.parse_args(argv)
    if args.action == 'clear':
        copy('')
        return 0
    if args.action == 'shared':   # never printed: the app's run log keeps what a command prints
        copy(shared_password())
        print(f'{SHARED}: on the clipboard')
        return 0
    if not args.host:
        parser.error('which site? give its host name, e.g. careers.example.com')
    name = service(args.host)
    if args.action == 'have':
        found = secret_store.get(name, ACCOUNT) is not None
        print('have' if found else 'none')
        return 0 if found else 1
    if args.action == 'new':
        password = for_site(args.length, symbols=not args.no_symbols)
        secret_store.put(name, password, ACCOUNT, label=f'Job Pilotto: {args.host}', comment=note(args.email, args.job))
        copy(password)
        print(f'stored {name}; on the clipboard, paste it')
        return 0
    password = secret_store.get(name, ACCOUNT)
    if password is None:
        print(f'no password stored for {args.host}')
        return 1
    copy(password)
    print('on the clipboard, paste it')
    return 0


if __name__ == '__main__':
    sys.exit(main())

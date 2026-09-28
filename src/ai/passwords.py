"""Employer-site passwords for Apply with Claude sessions, on the Mac and on Windows.

The session never sees or types a password: `new` generates one into this computer's secret store
(Keychain / Credential Manager, item job-pilotto.<host>.password) and puts it on the clipboard, the
session pastes it (cmd+v / ctrl+v), then `clear` empties the clipboard.

  python3 -m src.ai.passwords have <host>    exit 0 when one is stored for that site
  python3 -m src.ai.passwords new <host>     generate (16 chars, every class), store and copy
      [--length N] [--no-symbols]            to the rule a site shows; overwrites the stored one
  python3 -m src.ai.passwords copy <host>    copy the stored one
  python3 -m src.ai.passwords clear          empty the clipboard
"""
import argparse
import secrets
import string
import subprocess
import sys

from .. import secret_store

ACCOUNT = 'job-pilotto'


def service(host):
    return f'job-pilotto.{host}.password'


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
    parser.add_argument('action', choices=['have', 'new', 'copy', 'clear'])
    parser.add_argument('host', nargs='?')
    parser.add_argument('--length', type=int, default=16)
    parser.add_argument('--no-symbols', action='store_true')
    args = parser.parse_args(argv)
    if args.action == 'clear':
        copy('')
        return 0
    if not args.host:
        parser.error('which site? give its host name, e.g. careers.example.com')
    name = service(args.host)
    if args.action == 'have':
        found = secret_store.get(name, ACCOUNT) is not None
        print('have' if found else 'none')
        return 0 if found else 1
    if args.action == 'new':
        password = generate(max(8, args.length), '' if args.no_symbols else '!#%+-=?@_')
        secret_store.put(name, password, ACCOUNT, label=f'Job Pilotto: {args.host}')
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

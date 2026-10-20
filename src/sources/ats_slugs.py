"""Is this a well-formed feed slug for this job system? One answer per system, from each reader's own rule, for anything that takes a
(system, slug) pair from outside the engine (a route another install shared, a link a user pasted) before it reaches a reader.
Guarded by tests/test_ats_slugs.py, which loops over every feed type."""
import re

HOST = re.compile(r'[a-z0-9-]+(\.[a-z0-9-]+)+')
PLAIN = re.compile(r'[\w.-]{1,120}')
HOST_SYSTEMS = ('successfactors', 'phenom', 'eightfold')   # slug = the career site's host name; found from its page, never from a link


def slug_ok(system, slug):
    """True when `slug` is shaped like the system's slugs. Shape only: whether the board exists is the reader's business."""
    slug = str(slug or '')
    try:
        if system == 'workday':
            ats._split_workday(slug)
        elif system == 'oracle':
            ats.split_oracle(slug)
        elif system in HOST_SYSTEMS:
            return bool(HOST.fullmatch(slug))
        elif system == 'umantis':
            return bool(re.fullmatch(r'recruitingapp-\d{2,6}', slug))
        elif system in ('amazon', 'netflix', 'visit', 'careers'):
            return False   # one fixed site, a page one install read, or an address: none is shared as a board slug
        else:
            return bool(PLAIN.fullmatch(slug))
    except ValueError:
        return False
    return True


from . import ats  # noqa: E402  (at the end: ats imports this file back, so importing this file first works too)

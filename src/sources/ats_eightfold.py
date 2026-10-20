"""Eightfold career sites (jobs.vodafone.com...): the public search the site's own page calls (its pcsx search), no login.

Telecoms, banks and manufacturers run their careers pages on it, usually on the employer's own domain, so a site is found from its page
(`eightfold_site`), not from a link. Slug: the site's host name. The page names the employer's Eightfold domain; the search is asked for the
newest jobs, then for each of the user's own words (ats_sites.workday_terms), as Workday is. The list gives no job text, only title, place,
date and work mode. Guarded by tests/test_ats_eightfold.py.
"""
import html
import re
from datetime import datetime, timezone
import urllib.parse

EIGHTFOLD_STEP = 10       # jobs a request returns (the endpoint ignores a larger `num`)
EIGHTFOLD_ALL_PAGES = 10  # newest 100 with no word
EIGHTFOLD_TERM_PAGES = 3


def _domain(page):
    """The employer's Eightfold domain ('vodafone.com') and the host that serves the search, named in the page's embedded settings."""
    text = html.unescape(page or '')
    domain = re.search(r'"domain"\s*:\s*"([a-z0-9.-]+\.[a-z]{2,})"', text)
    host = re.search(r'"pcsDomain"\s*:\s*"([a-z0-9.-]+\.[a-z]{2,})"', text)
    return domain.group(1) if domain else '', host.group(1) if host else ''


def eightfold_site(page):
    """The host of an Eightfold career site when `page` is one of its pages (Eightfold's own CDN and its embedded domain settings), else ''."""
    domain, host = _domain(page)
    return host if domain and host and 'vscdn.net' in (page or '') else ''


def eightfold(slug):
    """Jobs of one Eightfold career site (see the module note)."""
    if not re.fullmatch(r'[a-z0-9-]+(\.[a-z0-9-]+)+', slug or ''):
        raise ValueError('not an Eightfold site')
    domain, _ = _domain(ats._get(f'https://{slug}/').decode('utf-8', 'replace'))
    if not domain:
        raise ValueError('not an Eightfold site')
    jobs, seen = [], set()
    for term, pages in [('', EIGHTFOLD_ALL_PAGES), *((term, EIGHTFOLD_TERM_PAGES) for term in ats.workday_terms())]:
        for index in range(pages):
            query = urllib.parse.urlencode({'domain': domain, 'query': term, 'start': EIGHTFOLD_STEP * index, 'sort_by': 'timestamp'})
            found = (ats._json(f'https://{slug}/api/pcsx/search?{query}').get('data') or {}).get('positions') or []
            for j in found:
                key = str(j.get('id') or '')
                if not key or key in seen:
                    continue
                seen.add(key)
                posted = j.get('postedTs')
                jobs.append(_job(key, j.get('name'), '; '.join(j.get('locations') or []) or j.get('location') or '',
                                 f"https://{slug}{j.get('positionUrl') or '/careers/job/' + key}",
                                 datetime.fromtimestamp(posted, timezone.utc).date().isoformat() if isinstance(posted, (int, float)) else '',
                                 '', (j.get('workLocationOption') or '') == 'remote'))
            if len(found) < EIGHTFOLD_STEP:
                break
    return jobs


from . import ats  # noqa: E402  (at the end: ats imports this file back, so importing this file first works too)
from .ats import _job  # noqa: E402

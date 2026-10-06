"""A web search for a company's own job site ("<company> jobs"), as a person would do it, for employers the scout cannot reach by name or website
(6 Oct 2026: Coop's jobs are on coopjobs.ch / jobs.coop.ch, Rolex's on carrieres-rolex.com). Brave Search (BRAVE_SEARCH_API_KEY, free plan:
2,000 searches a month) or, without it, SerpApi's Google search (SERPAPI_API_KEY, the Google Jobs key; one credit a search). Off without
either. Only result addresses are used, never their text; a job board or network is not an employer's job site and is left out.
"""
import json
import os
import urllib.parse
import urllib.request

from ..features import disabled
from . import careers

BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search'
SERP_URL = 'https://serpapi.com/search.json'
RESULTS = 5
# The word for "jobs" in the user's language, added to the search: Swiss and French sites title their pages "carrières", "Stellen".
JOB_WORDS = {'fr': 'emplois carrières', 'de': 'Stellen Jobs', 'it': 'lavoro carriere'}


def _get(url, headers=None):
    request = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'JobPilotto/1.0', **(headers or {})})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def provider():
    """'brave', 'serpapi' or None (off: no key, or JOB_PILOTTO_DISABLE=web_search)."""
    if disabled('web_search'):
        return None
    if os.getenv('BRAVE_SEARCH_API_KEY', '').strip():
        return 'brave'
    if os.getenv('SERPAPI_API_KEY', '').strip() and not disabled('google_jobs'):
        return 'serpapi'
    return None


def job_sites(company, language='', get=_get):
    """Up to RESULTS addresses that may be the company's own job site, best first; [] when off or the search fails."""
    which = provider()
    if not which:
        return []
    query = f'{company} jobs {JOB_WORDS.get(language, "")}'.strip()
    try:
        if which == 'brave':
            data = get(f'{BRAVE_URL}?' + urllib.parse.urlencode({'q': query, 'count': RESULTS}),
                       {'X-Subscription-Token': os.environ['BRAVE_SEARCH_API_KEY'].strip()})
            urls = [item.get('url') for item in (data.get('web') or {}).get('results') or []]
        else:
            data = get(f'{SERP_URL}?' + urllib.parse.urlencode({'engine': 'google', 'q': query, 'num': RESULTS, 'api_key': os.environ['SERPAPI_API_KEY'].strip()}))
            urls = [item.get('link') for item in data.get('organic_results') or []]
    except Exception as error:  # noqa: BLE001 — a search that fails leaves the employer as it was
        print(f'Warning: web search for {company} did not answer: {type(error).__name__}')
        return []
    return [url for url in dict.fromkeys(u for u in urls if isinstance(u, str) and u.startswith('https://') and careers.own_site(u))][:RESULTS]

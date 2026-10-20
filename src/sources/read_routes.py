"""Which way each site's posting text is read (jobposting, api, main, browser_only, refused): kept per site, shared as a fixed word, never a text or an address."""
from collections import Counter
from datetime import datetime, timedelta, timezone

from .careers_parse import registrable

ROUTES = ('jobposting', 'api', 'main', 'browser_only', 'refused')
NEGATIVE = ('browser_only', 'refused')   # the routes where an install can skip the request; the rest are hints


def _host(url):
    from . import visits   # inside the functions: visits imports visits_jobpages, which imports this file
    from .describe import walled
    return None if walled(url) else (registrable(visits.host_of(url or '')) or None)


def record(url, route, now=None):
    """Count one read of this site's posting by `route`. A sign-in site or an unknown word is not kept."""
    host = _host(url)
    if not host or route not in ROUTES:
        return
    from . import visits
    with visits.LOCK:
        data = visits._load()
        seen = data.setdefault('routes', {}).setdefault(host, {})
        seen[route] = int(seen.get(route) or 0) + 1
        seen['probed'] = (now or datetime.now(timezone.utc)).isoformat(timespec='seconds')
        visits._save(data)


def facts():
    """[{host, kind: 'route', route}]: for each site the route that read it most often (the pool's fixed words)."""
    from . import visits
    out = []
    for host, seen in sorted((visits._load().get('routes') or {}).items()):
        counts = Counter({r: n for r, n in (seen or {}).items() if r in ROUTES and isinstance(n, int)})
        if counts:
            out.append({'host': host, 'kind': 'route', 'route': counts.most_common(1)[0][0]})
    return out


def served(items):
    """{host: route} from the facts the pool serves (employer index); a fact of another shape is dropped."""
    return {f['host']: f['route'] for f in items or []
            if isinstance(f, dict) and f.get('kind') == 'route' and isinstance(f.get('host'), str) and f.get('route') in ROUTES}


PROBE_DAYS = 30   # a site the pool found closed is still asked once in this long, in case it opened (matches "Read refused sites")


def closed(pooled):
    """The registrable hosts the pool found closed to a plain read (refused, or only a browser shows the text)."""
    return {host for host, route in (pooled or {}).items() if route in NEGATIVE}


def skip(url, pooled, now=None):
    """True when this posting's site was found closed by the pool and this install has not looked within PROBE_DAYS: the request is not made.
    The first skip starts the clock; a real read (record) restarts it, so the site is asked once every PROBE_DAYS."""
    from . import visits
    host = _host(url)
    if not host or host not in closed(pooled):
        return False
    now = now or datetime.now(timezone.utc)
    with visits.LOCK:
        data = visits._load()
        seen = data.setdefault('routes', {}).setdefault(host, {})
        last = seen.get('probed')
        if last and last > (now - timedelta(days=PROBE_DAYS)).isoformat(timespec='seconds'):
            return True
        if last:
            return False   # due: ask it now; record() restarts the clock
        seen['probed'] = now.isoformat(timespec='seconds')
        visits._save(data)
        return True

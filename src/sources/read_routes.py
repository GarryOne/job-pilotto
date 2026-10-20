"""Which way each site's posting text is read (jobposting, api, main, browser_only, refused): kept per site, shared as a fixed word, never a text or an address."""
from collections import Counter

from . import visits
from .careers_parse import registrable

ROUTES = ('jobposting', 'api', 'main', 'browser_only', 'refused')
NEGATIVE = ('browser_only', 'refused')   # the routes where an install can skip the request; the rest are hints


def _host(url):
    from .describe import walled
    return None if walled(url) else (registrable(visits.host_of(url or '')) or None)


def record(url, route):
    """Count one read of this site's posting by `route`. A sign-in site or an unknown word is not kept."""
    host = _host(url)
    if not host or route not in ROUTES:
        return
    with visits.LOCK:
        data = visits._load()
        seen = data.setdefault('routes', {}).setdefault(host, {})
        seen[route] = int(seen.get(route) or 0) + 1
        visits._save(data)


def facts():
    """[{host, kind: 'route', route}]: for each site the route that read it most often (the pool's fixed words)."""
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

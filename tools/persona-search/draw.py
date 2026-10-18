"""The daily random draw (owner, 18 Oct 2026, Lab Job Search "Random draws"): one role family and one European city, picked by the date, and a fictional CV for them.
Both lists are data (tools/persona-search/draws.json); the pick is a hash of the seed, so the same seed gives the same draw on any machine; every name, mail and company is invented.
Usage: python3 tools/persona-search/draw.py <seed, e.g. 2026-10-18> <out dir>   -> <out>/draw/cv.pdf and <out>/draw/draw.json (seed, family, city, country)
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from personas import pdf  # noqa: E402

DATA = json.loads((Path(__file__).resolve().parent / 'draws.json').read_text(encoding='utf-8'))
FIRST = ['Alex', 'Sam', 'Robin', 'Jules', 'Charlie', 'Noa', 'Kim', 'Eli', 'Dani', 'Max']
LAST = ['Example', 'Sample', 'Testford', 'Demoson', 'Fictiva', 'Mockner', 'Placeholder', 'Imaginov']


def pick(seed):
    """(family, city, name) for this seed: a hash of the seed, so a re-run of a bad day is the same draw."""
    digits = int(hashlib.sha256(seed.encode()).hexdigest(), 16)
    families, cities = DATA['families'], DATA['cities']
    return (families[digits % len(families)], cities[(digits // len(families)) % len(cities)],
            f'{FIRST[(digits >> 40) % len(FIRST)]} {LAST[(digits >> 48) % len(LAST)]}')


def cv(family, city, name):
    """The CV lines: a template per family, years and employer invented, language of the country, English B2."""
    place = f"{city['city']}, {city['country']}"
    slug = name.lower().replace(' ', '.')
    return [name, f"{family['title']}, {place}", f'{slug}@example.test | +00 000 000000', '', 'SUMMARY',
            f"{family['title']} with 6 years of experience, based in {city['city']}.", family['duty'], '',
            'EXPERIENCE', f"2021 - now   {family['title']}, Example Group, {city['city']}", f"  - {family['duty']}",
            f"2018 - 2021  {family['title']}, Sample Works, {city['city']}", f"  - Same kind of work for a smaller employer; skills: {family['tools']}.", '',
            'EDUCATION', f"{family['education']}, {city['city']}, 2018", '',
            'LANGUAGES', f"{city['language']} native, English good (B2)", '',
            'WORK RIGHTS', f"Citizen of {city['country']}. Lives in {city['city']}; on-site or hybrid."]


def write(seed, out):
    family, city, name = pick(seed)
    folder = Path(out) / 'draw'
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'cv.pdf').write_bytes(pdf(cv(family, city, name)))
    info = {'seed': seed, 'family': family['id'], 'city': city['city'], 'country': city['country']}
    (folder / 'draw.json').write_text(json.dumps(info), encoding='utf-8')
    return info


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(json.dumps(write(sys.argv[1], sys.argv[2])))

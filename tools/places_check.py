"""The place sorter checked with real AI calls (owner, 7 Oct 2026: "so many bugs around it, and still regressing"): unit tests fake the AI, and
two of the day's bugs were the real model answering badly (Zürich "in" a Geneva search, Sion "best"). A fixed set of clear-cut locations for
a Geneva-area search, each with its one right answer; the push hook (tools/pre-push-check.sh) runs this when src/ai/place_triage.py or
src/sources/feeds.py changes, and blocks the push on any wrong answer. About 5 Haiku calls through Claude Code or the API key; temporary
files only, never anyone's data. Exit 0 when every answer is right."""
import json
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

SEARCH = {'locations': {'top_tier': ['geneva', 'nyon', 'morges', 'rolle', 'versoix', 'gland'], 'country_wide': [], 'abroad': []},
          'remote_jobs': ['No'], 'remote_excluded_regions': []}
RIGHTS = {'work_rights': ['Swiss B permit (authorized to work in Switzerland).']}
BEST = ['Carouge', 'Petit-Lancy, Switzerland', 'Meyrin, Genève, CH', 'Genève Cornavin, Genève, CH', '1211 Genf, Genf, CH', 'Nyon, Vaud, CH',
        'Morges', 'Gland, Vaud', 'Versoix', 'Rolle']
OUT = ['Lausanne', 'Zürich, Switzerland', 'Schlieren, Switzerland', 'Sion, Switzerland', 'Vevey, Switzerland', 'Fribourg, Switzerland',
       'Derby, England', 'London', 'Lyon, France']
VAGUE = ['Switzerland', 'Romandie']
POSTINGS = [{'url': 'https://check.test/geneva', 'title': 'Collaborateur/trice vente (Jouets) 45%', 'location': 'Switzerland', 'expect': 'best',
             'description': 'Geneva | Part-time 45% | Fixed-term. To strengthen our team in the Toys sector, we are looking, at the Geneva site, '
                            'for a motivated person as a Sales Assistant. Manor SA, whose headquarters are located in Basel, is the market leader.'},
            {'url': 'https://check.test/nowhere', 'title': 'Vendeur polyvalent', 'location': 'Switzerland', 'expect': 'unclear',
             'description': 'Our stores look for a seller. You advise customers, take care of the shelves and the till. A friendly team, '
                            'training on the job, good conditions. Send us your application, we look forward to meeting you.'}]


def main():
    from unittest import mock
    from src.ai import place_triage as p
    tmp = pathlib.Path(tempfile.mkdtemp())
    with mock.patch.object(p, 'STORE', tmp / 'places.json'), mock.patch.object(p, 'READ_STORE', tmp / 'read.json'), \
            mock.patch.object(p, '_preferences', lambda: RIGHTS):
        placed = p.decide(BEST + OUT + VAGUE, SEARCH)
        placed = p.vague(BEST + OUT + VAGUE, SEARCH)
        read = p.read([{k: v for k, v in job.items() if k != 'expect'} for job in POSTINGS], SEARCH)
    wrong = []
    for location in BEST:
        if placed.get(p.norm(location), '').split(':')[0] != 'best':
            wrong.append(f'{location}: expected best, got {placed.get(p.norm(location))}')
    for location in OUT:
        if placed.get(p.norm(location), '').split(':')[0] != 'out':
            wrong.append(f'{location}: expected out, got {placed.get(p.norm(location))}')
    for location in VAGUE:
        if placed.get(p.norm(location)) != 'out:vague':
            wrong.append(f'{location}: expected out:vague, got {placed.get(p.norm(location))}')
    for location in BEST + OUT:
        if placed.get(p.norm(location), '').endswith(':visa'):
            wrong.append(f'{location}: a visa flagged for a Swiss B permit')
    for job in POSTINGS:
        got = (read.get(job['url']) or {}).get('place')
        if got != job['expect']:
            wrong.append(f"posting {job['url']}: expected {job['expect']}, got {got}")
    print(json.dumps({'ok': not wrong, 'checked': len(BEST + OUT + VAGUE + POSTINGS), 'wrong': wrong}, ensure_ascii=False, indent=1))
    return 0 if not wrong else 1


if __name__ == '__main__':
    sys.exit(main())

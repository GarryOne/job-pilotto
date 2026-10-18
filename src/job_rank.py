"""The free ranking a timed search spends its AI on first (owner, 18 Oct 2026, change A of the search plan: "score the best jobs first: a free
ranking, then the AI scores from the top of it"; spec docs/superpowers/specs/2026-10-18-search-learns-sources.md). No AI and no word list of
ours: only the user's own strategy (config/search.json, drafted from their CV) is matched against the job:
- role: the title has one of their role words (a title only the AI's title sort let in comes after);
- level: the title names one of their levels ("senior");
- skills: how many of their stack words the title and the posting name (up to 4).
time_budget.best_first sorts by place first, then by this: the AI fit score, the facts reader, the title sort and the first-jobs slice all
start from the top. The score still decides what is shown; this only decides what is scored first when time is short.
Tests: tests/test_job_rank.py."""
import re
import unicodedata

from . import paths
from .paths import keyword_regex

SKILLS_MAX = 4
MARKS = re.compile('[\u0300-\u036f]')   # the accents NFKD splits off ("é" -> "e" + mark)
TEXT = 1500   # the posting's first characters: its title block and requirements (a first search sorts ~60,000 jobs: CI took 17 s for 20,000 at 4,000)


def ranker(search=None):
    """closeness(job) -> a number, higher = closer to the user's search, built once for a sort."""
    search = search if search is not None else paths.load_search_config()
    roles = [word for word in search.get('role_keywords') or [] if word]
    role = keyword_regex(roles) if roles else None
    levels = [word for word in search.get('level') or [] if word]
    level = keyword_regex(levels) if levels else None
    skills = [keyword_regex([word]) for word in search.get('quality_stack_keywords') or [] if word]

    def closeness(job):
        # as written and without accents ("Développeur"), each made once per job: a first search sorts tens of thousands
        title = job.get('title') or ''
        titles = (title,) if title.isascii() else (title, plain(title))
        text = f"{title}\n{(job.get('description') or '')[:TEXT]}"
        texts = (text,) if text.isascii() else (text, plain(text))   # no accents to remove: the costly part, skipped
        has = lambda pattern, where: any(pattern.search(each) for each in where)
        found = 0
        for skill in skills:
            found += has(skill, texts)
            if found >= SKILLS_MAX:
                break
        return (2 if role and has(role, titles) else 0) + (1 if level and has(level, titles) else 0) + found / 2
    return closeness


def plain(text):
    """The text without accents, like feeds.plain but in one C pass (feeds.plain's per-character loop was 3/4 of a 60,000-job sort)."""
    return MARKS.sub('', unicodedata.normalize('NFKD', text))

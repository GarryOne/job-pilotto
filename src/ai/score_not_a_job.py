"""A scored text that is not one job (a list of jobs, a job category, search results, a company page) never ranks as a match: the scorer's own
fixed answer basis.one_job (SCHEMA in src/ai/score.py) is False, so its score drops to 0 and its tier to C, with the reason said (owner, 18 Oct 2026:
"Finance vacatures", a recruiter's category page, sat in a finance candidate's top 10). An answer without the field (scored before it) is one job.
Tests: tests/test_score_not_a_job.py."""

GAP = 'Not one job you can apply to: a list of jobs, a category or a search page'


def is_one_job(data):
    return (data.get('basis') or {}).get('one_job') is not False


def mark(data):
    """The answer as kept: unchanged for one job; score 0, tier C and the reason first for anything else."""
    if is_one_job(data):
        return data
    data['score'], data['tier'] = 0, 'C'
    data['gaps'] = [GAP, *[gap for gap in data.get('gaps') or [] if gap != GAP]][:3]
    return data

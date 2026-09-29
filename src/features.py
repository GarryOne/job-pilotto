"""Optional features: what each one needs, what it costs, and one switch to turn any of them off.

The core (crawl jobs.ch, TechTree and employer feeds, rank them, print the digest) needs no keys.
Everything else switches itself on when the key or variable it needs is set, so a new developer
unlocks features one at a time. To turn one off without deleting its keys, list it in
JOB_PILOTTO_DISABLE (comma-separated, or "all"), e.g. JOB_PILOTTO_DISABLE=google_jobs,mail —
in .env locally, or as a GitHub repository variable for the scheduled runs.
"""
from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Feature:
    name: str
    label: str
    needs: tuple      # every one of these environment variables must be set (a nested tuple: any one of them)
    cost: str         # 'free', 'paid' or 'free tier'
    setup: str        # how to turn it on, one line


FEATURES = (
    Feature('discover', 'jobs.ch + TechTree discovery', (), 'free', 'on by default'),
    Feature('telegram', 'Telegram digest', ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'), 'free',
            'create a bot with @BotFather; README → Telegram'),
    Feature('notion', 'Notion tracking (applications, matches, run log)', ('NOTION_TOKEN',), 'free',
            'create a Notion integration and the pages in docs/notion-schema.md'),
    Feature('scout', 'Source scout (finds new employer feeds)', (), 'free', 'on by default'),
    Feature('enrich', 'AI stage 1: facts from each posting', ('ANTHROPIC_API_KEY', 'JOB_PILOTTO_ENRICH_MODEL'),
            'paid', 'ANTHROPIC_API_KEY + JOB_PILOTTO_ENRICH_MODEL=claude-haiku-4-5'),
    Feature('score', 'AI stage 2: fit score against your Profile',
            ('ANTHROPIC_API_KEY', 'JOB_PILOTTO_SCORE_MODEL', ('NOTION_TOKEN', 'JOB_PILOTTO_PROFILE_FILE')),
            'paid', 'ANTHROPIC_API_KEY + JOB_PILOTTO_SCORE_MODEL=claude-sonnet-5 (Profile from Notion or a local file)'),
    Feature('auto_kits', 'Auto-drafted application kits', ('ANTHROPIC_API_KEY', 'JOB_PILOTTO_AUTO_KIT_MAX', 'NOTION_TOKEN'),
            'paid', 'JOB_PILOTTO_AUTO_KIT_MAX=5 (plus the AI key and Notion)'),
    Feature('insights', 'Daily insight + weekly report', ('ANTHROPIC_API_KEY', 'JOB_PILOTTO_INSIGHT_MODEL', 'NOTION_TOKEN'),
            'paid', 'JOB_PILOTTO_INSIGHT_MODEL=claude-sonnet-5 (plus the AI key and Notion)'),
    Feature('google_jobs', 'Google Jobs via SerpApi', ('SERPAPI_API_KEY',), 'free tier',
            'SERPAPI_API_KEY from serpapi.com (free plan: 250 searches/month)'),
    Feature('transcribe', 'Interview recordings -> transcript with speakers (on this machine)', (), 'free',
            'pip install -r requirements-transcribe.txt (bundled in the Mac app); models download once (~520 MB)'),
    Feature('focus', 'Focus: what to do next, and reminders against a daily target', ('NOTION_TOKEN',), 'free',
            'on with Notion (the Desktop App: Focus)'),
    Feature('feedback', 'Employer feedback requests, collection and learning', ('NOTION_TOKEN',), 'free',
            'on with Notion (Focus and Jobs → Add employer feedback; Gmail collection uses the existing mail check)'),
    Feature('rejection_review', 'Why each rejection happened (after the Gmail check, or on demand)',
            ('ANTHROPIC_API_KEY', 'NOTION_TOKEN'), 'paid', 'on with the AI key and Notion (Claude Sonnet 5, a few cents each)'),
    Feature('mail', 'Gmail + Calendar reading (application news, recruiter leads)', ('GOOGLE_REFRESH_TOKEN', 'NOTION_TOKEN', 'ANTHROPIC_API_KEY'), 'paid',
            'python3 -m src.sources.google auth --github (the shared Job Pilotto app: one browser consent); '
            'own Google app: python3 -m src.sources.google setup; README → Gmail and Calendar'),
)
BY_NAME = {f.name: f for f in FEATURES}


def disabled_names(env=None):
    env = os.environ if env is None else env
    return {n.strip().lower() for n in (env.get('JOB_PILOTTO_DISABLE') or '').split(',') if n.strip()}


def disabled(name, env=None):
    """True when JOB_PILOTTO_DISABLE lists this feature (or "all")."""
    names = disabled_names(env)
    return name in names or 'all' in names


def _has(env, need):
    return any(env.get(var) for var in need) if isinstance(need, tuple) else bool(env.get(need))


def _name(need):
    return ' or '.join(need) if isinstance(need, tuple) else need


def configured(name, env=None):
    env = os.environ if env is None else env
    return all(_has(env, need) for need in BY_NAME[name].needs)


def enabled(name, env=None):
    return configured(name, env) and not disabled(name, env)


def status(env=None):
    """[(feature, 'on' | 'off' | 'disabled', missing variables)] for every optional feature."""
    env = os.environ if env is None else env
    rows = []
    for feature in FEATURES:
        missing = [_name(need) for need in feature.needs if not _has(env, need)]
        state = 'disabled' if disabled(feature.name, env) else 'off' if missing else 'on'
        rows.append((feature, state, missing))
    return rows

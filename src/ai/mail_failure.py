"""Why a Gmail check read nothing, in the app's words (NOT_CHECKED, failure_cause, failure_warning).
Guarded by tests/test_mail_run.py."""
from . import cost


# Why a check read nothing, in the app's words (desktop/lib/run-result.js MAIL_SKIPPED, held equal by desktop/test/engine-message-contract.test.js).
NOT_CHECKED = {
    'spend': 'not checked: the Anthropic API spend limit was reached',
    'plan': 'not checked: your Claude usage window is exhausted; it runs again later',
    'claude': 'not checked: Claude Code is not ready (Settings → AI)',
    'google': 'not checked: the Google sign-in expired (Settings → Gmail and Calendar)',
}
# The same reasons when the chosen engine is OpenAI's (the OpenAI API key or Codex): desktop/lib/run-result.js MAIL_SKIPPED_OPENAI.
NOT_CHECKED_OPENAI = {
    'spend': 'not checked: the OpenAI API credit or spend limit was reached',
    'plan': "not checked: your ChatGPT plan's Codex limit is reached; it runs again later",
    'claude': 'not checked: Codex is not ready (Settings → AI)',
    'google': NOT_CHECKED['google'],
}


def not_checked(cause, env=None):
    """The words for a cause, in the chosen engine's family."""
    from . import providers
    return (NOT_CHECKED_OPENAI if providers.spec(env).family == 'openai' else NOT_CHECKED)[cause]


def failure_cause(error):
    """'google', 'plan', 'claude', 'spend' or '' (an unknown failure)."""
    if 'invalid_grant' in str(error):
        return 'google'
    if cost.cli_limit(error):   # an engine's own limit (AiLimit): its plan, its key or credit, or it cannot run; told apart by the engine's own texts
        text = str(error)
        if 'usage window' in text or 'usage limit' in text:
            return 'plan'
        if 'spend limit' in text or 'no credit left' in text:
            return 'spend'
        return 'claude'
    return 'spend' if cost.limit_reached(error) else ''


def failure_warning(error):
    """The run row's warning for a check that failed: a known cause in the app's words; only an unknown one keeps its text, for whoever debugs it.
    #314: a revoked sign-in wrote Google's answer ("invalid_grant … Token has been expired or revoked") into the user's Notion run row."""
    cause = failure_cause(error)
    return not_checked(cause) if cause else f'check failed: {type(error).__name__}: {str(error)[:200]}'

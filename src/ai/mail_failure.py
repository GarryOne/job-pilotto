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


def failure_cause(error):
    """'google', 'plan', 'claude', 'spend' or '' (an unknown failure)."""
    if 'invalid_grant' in str(error):
        return 'google'
    if cost.cli_limit(error):
        return 'plan' if 'usage window' in str(error) else 'claude'
    return 'spend' if cost.limit_reached(error) else ''


def failure_warning(error):
    """The run row's warning for a check that failed: a known cause in the app's words; only an unknown one keeps its text, for whoever debugs it.
    #314: a revoked sign-in wrote Google's answer ("invalid_grant … Token has been expired or revoked") into the user's Notion run row."""
    cause = failure_cause(error)
    return NOT_CHECKED[cause] if cause else f'check failed: {type(error).__name__}: {str(error)[:200]}'

"""The `api` engine: the Anthropic SDK with the user's ANTHROPIC_API_KEY (or the free-credit relay's address). Billed per token.

The caller's params go to the SDK untouched (prompt caching's cache_control, effort, the web search tool) and its response comes back as
it is: the Anthropic path is the contract's reference shape, so nothing is translated. Guarded by tests/test_ai_providers.py.
"""
from .contract import Adapter

ACTIONS = ('enrich', 'score', 'kit', 'prep', 'insight', 'mail', 'inbox', 'review', 'interview', 'opportunity', 'added', 'import', 'scout', 'decide')


def sdk(action=''):
    """The SDK client. `action` names the AI step (one of ACTIONS) in a header the free-credit relay reads, so what each step costs can be
    told apart there (site/src/trial.js); Anthropic itself ignores it. Nothing about the job or the user is in it."""
    import anthropic
    return anthropic.Anthropic(default_headers={'x-jp-action': action}) if action in ACTIONS else anthropic.Anthropic()


def transient_errors():
    """The SDK's errors that mean "down or busy, try the next run" (after its own retries)."""
    try:
        import anthropic
    except ImportError:
        return ()
    return (anthropic.APIConnectionError, anthropic.RateLimitError, anthropic.InternalServerError)


def permanent_errors():
    try:
        import anthropic
    except ImportError:
        return ()
    return (anthropic.APIStatusError,)


class AnthropicApi(Adapter):
    name, family = 'api', 'claude'
    label = 'Anthropic API'

    def __init__(self, client=None, action='', log=None):
        super().__init__(log=log)
        self.client = client if client is not None else sdk(action)   # made now, as before: a missing SDK says so at once

    def complete(self, request):
        return self.client.messages.create(**request.params)

"""The subject a `git commit` command line would write, when it is given inline (-m "...", or -m "$(cat <<'EOF' ...)"); else nothing.
Used by tools/pre-push-check.sh to stop a subject over 72 characters at commit time, where a shorter one costs nothing (an amend later is often denied)."""
import re
import sys


def subject(command):
    if not re.search(r'\bgit\b[^;&|]*\bcommit\b', command):
        return ''
    heredoc = re.search(r"<<-?\s*['\"]?(\w+)['\"]?\n(.*?)\n", command, re.S)
    if heredoc:
        return heredoc.group(2).strip()
    inline = re.search(r'''(?:-[a-zA-Z]*m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')''', command, re.S)
    if inline:
        text = inline.group(1) if inline.group(1) is not None else inline.group(2)
        return text.split('\n', 1)[0].strip()
    return ''


if __name__ == '__main__':
    print(subject(sys.stdin.read()))

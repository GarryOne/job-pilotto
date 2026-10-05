// What an issue should say about the run that found it (5 Oct 2026), so a false positive can be explained later with facts, not guessed: how far the tested build was behind main
// (a stale sighting), whether the suite finished (a cancelled job's partial findings), and how recently the suite's own file changed (a new test is a risk group of its own). Pure.
export function ageWords(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

// `behind`: commits main has beyond the tested build (null when unknown); `incomplete`: the suites whose job was cancelled or timed out in this run; `suite`: this finding's suite.
export function contextLine({behind = null, incomplete = [], suite = ''} = {}) {
  const parts = [];
  if (Number.isFinite(behind)) parts.push(behind === 0 ? 'the tested build is main itself' : `the tested build was ${behind} commit${behind === 1 ? '' : 's'} behind main`);
  if (suite && incomplete.includes(suite)) parts.push('its suite did NOT finish (cancelled or timed out): partial results');
  else if (suite) parts.push('its suite finished');
  return parts.length ? `🧭 ${parts.join(' · ')}` : '';
}

// `last`: {sha, date} of the commit that last changed the suite's file. Only a finding of a suite step has one.
export function stepAgeLine({last = null, now = Date.now()} = {}) {
  if (!last?.date || Number.isNaN(Date.parse(last.date))) return '';
  return `🧪 the suite's file last changed ${ageWords(now - Date.parse(last.date))} ago (\`${String(last.sha || '').slice(0, 7)}\`)`;
}

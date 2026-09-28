// Is this the same form question? Claude rewords and shortens ("I agree to use only my own words; AI-generated content
// will disqualify my application"), the form page sends its own label, cut at 120 characters ("During this application
// process I agree to use only my own words. I understand that plagiarism, the use of AI or other g"). The same question
// when one contains the other, or when they share most of their words (70% and 3+) or many of them (5+).
const norm = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'with', 'this', 'that', 'what', 'have', 'did', 'how',
  'please', 'which', 'any', 'our', 'will', 'can', 'not']);
const words = text => [...new Set(norm(text).split(' ').filter(word => word.length >= 3 && !STOP.has(word)))];
export function sameQuestion(a, b) {
  const [x, y] = [norm(a), norm(b)];
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const [shorter, longer] = words(a).length <= words(b).length ? [words(a), words(b)] : [words(b), words(a)];
  const shared = shorter.filter(word => longer.includes(word)).length;
  return shared >= 5 || (shared >= 3 && shared / shorter.length >= 0.7);
}

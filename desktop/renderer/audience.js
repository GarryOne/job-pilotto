// Is this candidate looking for IT / engineering work? The same rule as src/coverage.py looks_technical (a table of cases in tests/fixtures/audience_cases.json holds both to it).
// Pure, no DOM: main.js answers the window's question with it, and the tips use it to keep IT examples away from everyone else.
const TECH_WORDS = /(?<![a-z])(software|developer|devops|sre|site reliability|cloud|backend|back-end|frontend|front-end|full.?stack|data|analytics|machine learning|ml|infrastructure|platform|sysadmin|sysop|systems?|syst[eè]mes?|programmer|sdet|qa|security|network|database|kubernetes|it|entwickler|informatiker|d[eé]veloppeur|sviluppatore|desarrollador|ontwikkelaar|programista|sistemista)(?![a-z])/i;
// Compound words (German "Softwareentwickler") have no word boundary to match on: these stems count anywhere.
const STEMS = ['software', 'entwickler', 'informatik', 'devops', 'kubernetes', 'programmier', 'sysadmin', 'systemadmin'];
const words = fragment => String(fragment).replace(/\\[bwsd]|[\\^$()|?*+[\]{}.]/g, ' ');

// Role keywords (regex fragments or plain words) -> true when any names IT/engineering work. An empty list is unknown, not non-technical (as in Python).
export const looksTechnical = (keywords = []) => !keywords.length || keywords.map(words).some(word => TECH_WORDS.test(word) || STEMS.some(stem => word.toLowerCase().includes(stem)));

// What to show: IT-only guidance only to someone who is clearly technical: with no roles known yet, the general version is the safe one.
export const clearlyTechnical = (keywords = []) => keywords.length > 0 && looksTechnical(keywords);

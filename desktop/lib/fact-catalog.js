// The facts of Your details that forms ask most, with their fixed ids (owner, 18 Oct 2026): the one list lib/missing-facts.js asks from and the site validates reports against
// (site/src/fact-asks.js). Pure data, no imports, so the site (which has no AI package) can load it. Guarded by test/missing-facts.test.js.

// What Your details holds, in the order a fresh install is asked.
export const CATALOG = [
  {id: 'permit', home: 'eligibility', label: 'Work permit / visa', kind: 'text', hint: 'For example citizen, permanent residence or the visa you hold'},
  {id: 'sponsorship', home: 'eligibility', label: 'Need visa sponsorship?', kind: 'yes_no', hint: 'Whether an employer must sponsor your right to work'},
  {id: 'notice', home: 'availability', label: 'Notice period', kind: 'duration', hint: 'How long until you could start a new job'},
  {id: 'start', home: 'availability', label: 'Earliest start date', kind: 'date', hint: 'The first day you could begin'},
  {id: 'salary', home: 'availability', label: 'Salary expectation', kind: 'salary', hint: 'What forms ask as your expected pay'},
  {id: 'languages', home: 'languages', label: 'Languages', kind: 'language', hint: 'The languages you work in and your level'},
];
export const byId = id => CATALOG.find(fact => fact.id === id);


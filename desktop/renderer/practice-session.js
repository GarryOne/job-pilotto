// Interviews → Insights → "Start practice session": rehearse the "Practice next" steps out loud, one at a time, with a
// countdown for each. Pure state (test/practice-session.test.js); pages/interviews.js draws it. No AI, nothing recorded.
export const STEP_SECONDS = 300;

// "About 15 minutes": five per step, never under five.
export const minutes = count => Math.max(5, count * 5);

// The steps still to do (a ticked step is done).
export function begin(steps = []) {
  const todo = steps.filter(step => !step.done).map(step => ({text: step.text, title: step.title, detail: step.detail}));
  return {steps: todo, index: 0, remaining: STEP_SECONDS, running: false, outcomes: [], finished: todo.length === 0};
}

export const current = state => (state.finished ? null : state.steps[state.index] || null);

// One second: only while started.
export function tick(state) {
  if (!state.running || state.finished) return state;
  const remaining = Math.max(0, state.remaining - 1);
  return {...state, remaining, running: remaining > 0};
}

export const toggle = state => (state.finished || state.remaining === 0 ? state : {...state, running: !state.running});

// outcome: 'done' or 'skipped'. The next step starts with a fresh, stopped clock; after the last one it's over.
export function finishStep(state, outcome) {
  if (state.finished) return state;
  const step = state.steps[state.index];
  const outcomes = [...state.outcomes, {text: step.text, outcome}];
  const index = state.index + 1;
  return {...state, outcomes, index, remaining: STEP_SECONDS, running: false, finished: index >= state.steps.length};
}

export function summary(state) {
  const done = state.outcomes.filter(item => item.outcome === 'done');
  return {done: done.length, skipped: state.outcomes.length - done.length, total: state.steps.length, doneSteps: done.map(item => item.text)};
}

export const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

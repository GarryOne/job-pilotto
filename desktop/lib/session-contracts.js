// Runtime contracts for session IPC requests, responses and public session views; errors never contain values.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string';
const id = value => string(value) && value.trim().length > 0;
const boolean = value => typeof value === 'boolean';
const integer = value => Number.isInteger(value) && value > 0;
const optional = check => value => value === undefined || check(value);
const nullable = check => value => value === null || check(value);
const array = check => value => Array.isArray(value) && value.every(check);
const oneOf = values => value => values.includes(value);
const shape = fields => value => object(value) && Object.entries(fields).every(([name, check]) => check(value[name]));

export class ContractError extends TypeError {
  constructor(channel, direction, field) {
    super(`Session contract: ${channel} ${direction} ${field}`);
    this.channel = channel; this.direction = direction; this.field = field;
  }
}
const sessionFields = {
  id, url: string, title: string, company: string,
  status: oneOf(['running', 'input', 'done', 'ended', 'failed']), note: string, startedAt: string,
  question: optional(string), brief: optional(string), location: optional(string), workMode: optional(string), outcome: optional(string),
  live: optional(boolean), resumable: optional(boolean), askAtStart: optional(boolean),
  endedAt: optional(nullable(string)), needsYouSince: optional(nullable(string)), exitCode: optional(nullable(Number.isInteger)),
};
export function assertSession(value, channel = 'session', direction = 'response') {
  if (!object(value)) throw new ContractError(channel, direction, 'object');
  for (const [field, check] of Object.entries(sessionFields)) if (!check(value[field])) throw new ContractError(channel, direction, field);
  return value;
}
const session = shape(sessionFields);
const result = shape({ok: boolean, error: optional(string), cancelled: optional(boolean), submitted: optional(boolean), session: optional(session)});
const voidResult = value => value === undefined;
const snapshot = shape({data: string, cols: integer, rows: integer});
const message = value => object(value) && optional(string)(value.at) && optional(string)(value.time) && (
  (['you', 'claude'].includes(value.kind) && string(value.text)) || (value.kind === 'steps' && array(string)(value.steps)));
const leftOpen = shape({choice: oneOf(['keep', 'each', 'reset']), kept: integerOrZero,
  asked: optional(array(id)), reset: optional(array(string)), failed: optional(array(shape({url: string, error: optional(string)})))});
function integerOrZero(value) { return Number.isInteger(value) && value >= 0; }

export const sessionContracts = Object.freeze({
  sessions: {args: [], response: array(session)},
  sessionOutput: {args: [id], response: string},
  sessionTranscript: {args: [id], response: nullable(array(message))},
  sessionSnapshot: {args: [id], response: snapshot},
  sessionWrite: {args: [id, string], response: voidResult},
  sessionResize: {args: [id, integer, integer], response: voidResult},
  sessionStop: {args: [id], response: voidResult},
  sessionRemove: {args: [id], response: voidResult},
  sessionSubmitted: {args: [id], response: nullable(id)},
  sessionResume: {args: [id], response: result},
  sessionCancel: {args: [id], response: result},
  sessionSkip: {args: [id], response: result},
  sessionRestart: {args: [id], response: result},
  sessionFinish: {args: [id], response: result},
  sessionsLeftOpen: {args: [array(id)], response: leftOpen},
});

export function validateSessionCall(channel, args) {
  const contract = sessionContracts[channel];
  if (!contract) throw new ContractError(channel, 'request', 'unknown channel');
  if (args.length !== contract.args.length) throw new ContractError(channel, 'request', 'argument count');
  contract.args.forEach((check, index) => { if (!check(args[index])) throw new ContractError(channel, 'request', `argument ${index + 1}`); });
}
export function validateSessionResult(channel, value) {
  if (!sessionContracts[channel]?.response(value)) throw new ContractError(channel, 'response', 'shape');
  return value;
}
export function sessionIpc(ipcMain, log = () => {}) {
  return {handle(channel, handler) {
    if (!sessionContracts[channel]) throw new ContractError(channel, 'registration', 'unknown channel');
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        validateSessionCall(channel, args);
        return validateSessionResult(channel, await handler(event, ...args));
      } catch (error) {
        if (error instanceof ContractError) log('sessions', 'IPC contract rejected', {channel, direction: error.direction, field: error.field});
        throw error;
      }
    });
  }};
}

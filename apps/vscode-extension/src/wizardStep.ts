export type InputStepResult<T> = { kind: 'accepted'; value: T } | { kind: 'cancelled' };
export function toInputStepResult<T>(value: T | undefined): InputStepResult<T> { return value === undefined ? { kind: 'cancelled' } : { kind: 'accepted', value }; }

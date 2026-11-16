import { formatIssue, type Issue } from '@gamex/model';

/** The model cannot be run (it did not validate, or a parameter override is invalid). */
export class EngineModelError extends Error {
  override readonly name = 'EngineModelError';
  constructor(
    message: string,
    readonly issues: readonly Issue[] = [],
  ) {
    super(issues.length === 0 ? message : `${message}\n${issues.map(formatIssue).join('\n')}`);
  }
}

/** A formula failed while running (e.g. division by zero, a curve tier out of range). */
export class EngineRuntimeError extends Error {
  override readonly name = 'EngineRuntimeError';
  constructor(
    message: string,
    readonly code: string,
    readonly nodeRef: string,
    readonly expression?: string,
  ) {
    super(`${nodeRef}: ${message}${expression === undefined ? '' : ` — in "${expression}"`}`);
  }
}

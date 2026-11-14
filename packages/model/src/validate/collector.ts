import type { Issue, IssueSeverity } from '../issues.js';
import { toPointer } from '../json/pointer.js';

export type Path = readonly (string | number)[];

export class IssueCollector {
  readonly issues: Issue[] = [];

  add(
    severity: IssueSeverity,
    code: string,
    path: Path,
    message: string,
    extra: { hint?: string | undefined; nodeRef?: string | undefined; column?: number } = {},
  ): void {
    const issue: { -readonly [K in keyof Issue]: Issue[K] } = {
      severity,
      code,
      path: toPointer(path),
      message,
    };
    if (extra.hint !== undefined) issue.hint = extra.hint;
    if (extra.nodeRef !== undefined) issue.nodeRef = extra.nodeRef;
    if (extra.column !== undefined) issue.column = extra.column;
    this.issues.push(issue);
  }

  error(
    code: string,
    path: Path,
    message: string,
    extra?: { hint?: string | undefined; nodeRef?: string | undefined; column?: number },
  ): void {
    this.add('error', code, path, message, extra);
  }

  warning(
    code: string,
    path: Path,
    message: string,
    extra?: { hint?: string | undefined; nodeRef?: string | undefined },
  ): void {
    this.add('warning', code, path, message, extra);
  }

  get hasErrors(): boolean {
    return this.issues.some((i) => i.severity === 'error');
  }
}

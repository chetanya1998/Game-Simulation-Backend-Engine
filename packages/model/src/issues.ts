export type IssueSeverity = 'error' | 'warning';

/**
 * A validation finding: what failed (`code`, `message`), where (`path` as a JSON Pointer into the model,
 * plus `line`/`column` when the model came from a file) and how to fix it (`hint`).
 */
export interface Issue {
  readonly severity: IssueSeverity;
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly hint?: string;
  /** Typed reference of the node concerned, e.g. "action:revive". */
  readonly nodeRef?: string;
  readonly source?: string;
  readonly line?: number;
  readonly column?: number;
}

/** Formats an issue as `file:line:col: error CODE at /path: message (hint)`. */
export function formatIssue(issue: Issue): string {
  const where =
    issue.source === undefined
      ? ''
      : `${issue.source}${issue.line === undefined ? '' : `:${String(issue.line)}${issue.column === undefined ? '' : `:${String(issue.column)}`}`}: `;
  const hint = issue.hint === undefined ? '' : ` — ${issue.hint}`;
  return `${where}${issue.severity} ${issue.code} at ${issue.path === '' ? '/' : issue.path}: ${issue.message}${hint}`;
}

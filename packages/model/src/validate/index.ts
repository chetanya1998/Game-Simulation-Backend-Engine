import type { Issue } from '../issues.js';
import { parseJsonWithSourceMap, type SourceMap } from '../json/parse.js';
import { parentPointer } from '../json/pointer.js';
import { checkSchemaVersion } from '../migrations.js';
import { planImplicit } from '../normalize.js';
import { GameModelSchema, type GameModel } from '../schema/game-model.js';
import { IssueCollector } from './collector.js';
import { buildEnvs } from './env.js';
import { checkExpressions } from './expressions.js';
import { checkIdentity } from './identity.js';
import { indexNodes, listNodes } from './nodes.js';
import { checkRanges } from './ranges.js';
import { checkReferences } from './references.js';
import { checkSemantics } from './semantics.js';

export interface ValidateOptions {
  /** File name used in issues, e.g. "gamex/game-model.json". */
  readonly source?: string;
}

export interface ValidationResult {
  /** True when there are no errors (warnings are allowed). */
  readonly ok: boolean;
  /** The schema-valid model, when it passed the schema layer. */
  readonly model?: GameModel;
  readonly issues: readonly Issue[];
}

function zodCode(code: string): string {
  return `SCHEMA_${code.toUpperCase()}`;
}

function locate(
  issues: readonly Issue[],
  map: SourceMap | undefined,
  source: string | undefined,
): Issue[] {
  return issues.map((issue) => {
    const located: { -readonly [K in keyof Issue]: Issue[K] } = { ...issue };
    if (source !== undefined) located.source = source;
    if (map === undefined) {
      delete located.column;
      return located;
    }
    let pointer: string | undefined = issue.path;
    while (pointer !== undefined && !map.values.has(pointer)) pointer = parentPointer(pointer);
    const isKeyIssue = issue.code === 'SCHEMA_UNRECOGNIZED_KEYS';
    const position =
      pointer === undefined
        ? undefined
        : isKeyIssue
          ? (map.keys.get(pointer) ?? map.values.get(pointer))
          : map.values.get(pointer);
    if (position === undefined) {
      delete located.column;
      return located;
    }
    located.line = position.line;
    // Expression issues carry an offset into the string; add it (+1 for the opening quote).
    located.column =
      issue.column !== undefined && pointer === issue.path
        ? position.column + 1 + issue.column
        : position.column;
    return located;
  });
}

/**
 * Validates a Game Model in layers — JSON syntax, schema version, schema, identity, references,
 * expressions, ranges, semantics — collecting every issue rather than stopping at the first.
 * Accepts JSON text (issues then carry line/column) or an already-parsed value.
 */
export function validateGameModel(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const issues = new IssueCollector();
  let value: unknown = input;
  let sourceMap: SourceMap | undefined;

  if (typeof input === 'string') {
    const parsed = parseJsonWithSourceMap(input);
    if (!parsed.ok) {
      const issue: Issue = {
        severity: 'error',
        code: 'JSON_SYNTAX',
        path: '',
        message: parsed.message,
        line: parsed.position.line,
        column: parsed.position.column,
        hint: 'Fix the JSON syntax; the file could not be read.',
        ...(options.source === undefined ? {} : { source: options.source }),
      };
      return { ok: false, issues: [issue] };
    }
    value = parsed.value;
    sourceMap = parsed.sourceMap;
  }

  for (const issue of checkSchemaVersion(value)) issues.issues.push(issue);
  if (issues.hasErrors)
    return { ok: false, issues: locate(issues.issues, sourceMap, options.source) };

  const result = GameModelSchema.safeParse(value);
  if (!result.success) {
    for (const zi of result.error.issues) {
      const keys = zi.code === 'unrecognized_keys' ? zi.keys : [];
      if (keys.length > 0) {
        for (const key of keys) {
          issues.error(
            zodCode(zi.code),
            [...zi.path.map((p) => (typeof p === 'symbol' ? String(p) : p)), key],
            `Unknown field "${key}"`,
            {
              hint: 'Remove it or check its spelling; the schema does not allow extra fields.',
            },
          );
        }
      } else {
        issues.error(
          zodCode(zi.code),
          zi.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
          zi.message,
        );
      }
    }
    return { ok: false, issues: locate(issues.issues, sourceMap, options.source) };
  }

  const model = result.data;
  const plan = planImplicit(model);
  const nodes = listNodes(model);
  checkIdentity(model, nodes, plan, issues);
  const refs = checkReferences(
    model,
    indexNodes(
      nodes,
      plan.variables.map((v) => v.id),
    ),
    issues,
  );
  const usage = checkExpressions(model, buildEnvs(model, plan), issues);
  checkRanges(model, issues);
  checkSemantics(model, nodes, refs, usage, issues);

  return { ok: !issues.hasErrors, model, issues: locate(issues.issues, sourceMap, options.source) };
}

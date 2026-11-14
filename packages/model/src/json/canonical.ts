/**
 * Canonical JSON: the same value always serializes to the same bytes. Object keys are ordered by a
 * fixed priority list (so files read naturally: `id`, `key`, `name` first, `provenance` last), then
 * alphabetically; 2-space indent; trailing newline. Numbers use ECMAScript's shortest round-trip form.
 */

export const TOP_LEVEL_ORDER = [
  'meta',
  'entities',
  'resources',
  'constants',
  'variables',
  'actions',
  'rules',
  'stateMachine',
  'flows',
  'monetization',
  'personas',
  'kpis',
  'invariants',
  'gaps',
] as const;

const FIRST = ['$comment', 'id', 'key', 'name', 'kind', 'type', 'description'];
const LAST = ['provenance'];

function rank(key: string): number {
  const top = (TOP_LEVEL_ORDER as readonly string[]).indexOf(key);
  if (top >= 0) return top - 100;
  const first = FIRST.indexOf(key);
  if (first >= 0) return first - 50;
  return LAST.includes(key) ? 1 : 0;
}

export function compareKeys(a: string, b: string): number {
  const d = rank(a) - rank(b);
  if (d !== 0) return d;
  return a < b ? -1 : a > b ? 1 : 0;
}

function write(value: unknown, indent: string): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = indent + '  ';
    return `[\n${value.map((v) => inner + write(v, inner)).join(',\n')}\n${indent}]`;
  }
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value))
        throw new TypeError(`Cannot serialize non-finite number ${String(value)}`);
      return JSON.stringify(value);
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'object': {
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => v !== undefined,
      );
      if (entries.length === 0) return '{}';
      entries.sort(([a], [b]) => compareKeys(a, b));
      const inner = indent + '  ';
      return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${write(v, inner)}`).join(',\n')}\n${indent}}`;
    }
    default:
      throw new TypeError(`Cannot serialize ${typeof value}`);
  }
}

/** Serializes a JSON-compatible value canonically (undefined members are omitted). */
export function canonicalStringify(value: unknown): string {
  return `${write(value, '')}\n`;
}

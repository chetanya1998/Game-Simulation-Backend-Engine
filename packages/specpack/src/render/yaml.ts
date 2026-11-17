/**
 * Minimal deterministic YAML emitter for JSON-compatible data. Strings are always double-quoted with JSON
 * escaping (a valid YAML double-quoted scalar), so the output never depends on YAML's implicit typing.
 */
function scalar(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('YAML: non-finite number');
    return JSON.stringify(v);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  throw new TypeError(`YAML: unsupported ${typeof v}`);
}

function isEmptyContainer(v: unknown): string | undefined {
  if (Array.isArray(v) && v.length === 0) return '[]';
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
    return '{}';
  return undefined;
}

function emit(v: unknown, indent: string): string {
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        const empty = isEmptyContainer(item);
        if (empty !== undefined) return `${indent}- ${empty}`;
        if (item !== null && typeof item === 'object') {
          const inner = emit(item, `${indent}  `);
          return `${indent}- ${inner.slice(indent.length + 2)}`;
        }
        return `${indent}- ${scalar(item)}`;
      })
      .join('\n');
  }
  if (v !== null && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => {
        const key = /^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(k) ? k : JSON.stringify(k);
        const empty = isEmptyContainer(x);
        if (empty !== undefined) return `${indent}${key}: ${empty}`;
        if (x !== null && typeof x === 'object')
          return `${indent}${key}:\n${emit(x, `${indent}  `)}`;
        return `${indent}${key}: ${scalar(x)}`;
      })
      .join('\n');
  }
  return `${indent}${scalar(v)}`;
}

export function toYaml(value: unknown, header?: string): string {
  return `${header === undefined ? '' : `# ${header}\n`}${isEmptyContainer(value) ?? emit(value, '')}\n`;
}

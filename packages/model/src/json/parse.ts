import { escapePointerSegment } from './pointer.js';

/** 1-based line and column of a JSON token. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** Maps JSON Pointers to the position of the value (and, for object members, the key). */
export interface SourceMap {
  readonly values: ReadonlyMap<string, Position>;
  readonly keys: ReadonlyMap<string, Position>;
}

export type JsonParseResult =
  | { readonly ok: true; readonly value: unknown; readonly sourceMap: SourceMap }
  | { readonly ok: false; readonly message: string; readonly position: Position };

class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

/**
 * A small RFC 8259 JSON parser that also records where every value lives, so validation errors can
 * point to file/line/column. Pure (no I/O); duplicate keys are rejected because they hide edits.
 */
export function parseJsonWithSourceMap(text: string): JsonParseResult {
  const values = new Map<string, Position>();
  const keys = new Map<string, Position>();
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);

  const positionOf = (offset: number): Position => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (lineStarts[lo] ?? 0) + 1 };
  };

  let i = 0;
  const ws = (): void => {
    while (i < text.length && ' \t\n\r'.includes(text.charAt(i))) i++;
  };
  const expect = (ch: string): void => {
    if (text.charAt(i) !== ch)
      throw new JsonSyntaxError(
        `Expected "${ch}" but found ${i < text.length ? `"${text.charAt(i)}"` : 'end of file'}`,
        i,
      );
    i++;
  };

  const parseString = (): string => {
    const start = i;
    expect('"');
    while (i < text.length && text.charAt(i) !== '"') {
      const c = text.charCodeAt(i);
      if (c < 0x20)
        throw new JsonSyntaxError('Control character in string; escape it (e.g. \\n)', i);
      if (text.charAt(i) === '\\') i++;
      i++;
    }
    if (i >= text.length) throw new JsonSyntaxError('Unterminated string', start);
    i++;
    try {
      return JSON.parse(text.slice(start, i)) as string;
    } catch {
      throw new JsonSyntaxError('Invalid escape sequence in string', start);
    }
  };

  const parseValue = (pointer: string): unknown => {
    ws();
    values.set(pointer, positionOf(i));
    const ch = text.charAt(i);
    if (ch === '{') {
      i++;
      const obj: Record<string, unknown> = {};
      ws();
      if (text.charAt(i) === '}') {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        const keyOffset = i;
        if (text.charAt(i) !== '"')
          throw new JsonSyntaxError('Expected a property name in double quotes', i);
        const key = parseString();
        if (Object.hasOwn(obj, key)) throw new JsonSyntaxError(`Duplicate key "${key}"`, keyOffset);
        const child = `${pointer}/${escapePointerSegment(key)}`;
        keys.set(child, positionOf(keyOffset));
        ws();
        expect(':');
        Object.defineProperty(obj, key, {
          value: parseValue(child),
          enumerable: true,
          writable: true,
          configurable: true,
        });
        ws();
        if (text.charAt(i) === ',') {
          i++;
          continue;
        }
        expect('}');
        return obj;
      }
    }
    if (ch === '[') {
      i++;
      const arr: unknown[] = [];
      ws();
      if (text.charAt(i) === ']') {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue(`${pointer}/${String(arr.length)}`));
        ws();
        if (text.charAt(i) === ',') {
          i++;
          continue;
        }
        expect(']');
        return arr;
      }
    }
    if (ch === '"') return parseString();
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      text.slice(i, i + 400),
    );
    if (literal === null)
      throw new JsonSyntaxError(
        i < text.length ? `Unexpected character "${ch}"` : 'Unexpected end of file',
        i,
      );
    i += literal[0].length;
    return JSON.parse(literal[0]) as unknown;
  };

  try {
    const value = parseValue('');
    ws();
    if (i < text.length)
      throw new JsonSyntaxError(
        `Unexpected "${text.charAt(i)}" after the end of the JSON document`,
        i,
      );
    return { ok: true, value, sourceMap: { values, keys } };
  } catch (error) {
    if (error instanceof JsonSyntaxError)
      return { ok: false, message: error.message, position: positionOf(error.offset) };
    throw error;
  }
}

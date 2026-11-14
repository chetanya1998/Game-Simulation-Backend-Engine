import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalStringify,
  compareKeys,
  escapePointerSegment,
  parentPointer,
  parseJsonWithSourceMap,
  toPointer,
} from '@gamex/model';

describe('JSON pointers', () => {
  it('escapes ~ and /', () => {
    expect(escapePointerSegment('a/b~c')).toBe('a~1b~0c');
    expect(toPointer(['actions', 3, 'limits'])).toBe('/actions/3/limits');
    expect(toPointer([])).toBe('');
  });

  it('finds parents', () => {
    expect(parentPointer('/a/b/0')).toBe('/a/b');
    expect(parentPointer('/a')).toBe('');
    expect(parentPointer('')).toBeUndefined();
  });
});

describe('parseJsonWithSourceMap', () => {
  const text = '{\n  "a": [1, {"b": "x"}],\n  "c/d": true\n}\n';

  it('parses like JSON.parse and maps pointers to positions', () => {
    const r = parseJsonWithSourceMap(text);
    if (!r.ok) throw new Error(r.message);
    expect(r.value).toEqual(JSON.parse(text));
    expect(r.sourceMap.values.get('')).toEqual({ line: 1, column: 1 });
    expect(r.sourceMap.values.get('/a/1/b')).toEqual({ line: 2, column: 18 });
    expect(r.sourceMap.keys.get('/c~1d')).toEqual({ line: 3, column: 3 });
    expect(r.sourceMap.values.get('/c~1d')).toEqual({ line: 3, column: 10 });
  });

  it.each([
    ['{"a": 1,}', 'Expected a property name', 1, 9],
    ['{"a": 1, "a": 2}', 'Duplicate key "a"', 1, 10],
    ['[1, 2', 'Expected "]"', 1, 6],
    ['{\n  "a": tru\n}', 'Unexpected character "t"', 2, 8],
    ['"abc', 'Unterminated string', 1, 1],
    ['"a\\qb"', 'Invalid escape', 1, 1],
    ['"a\nb"', 'Control character', 1, 3],
    ['{} x', 'after the end', 1, 4],
    ['', 'Unexpected end of file', 1, 1],
  ])('reports %j: %s at %d:%d', (input, message, line, column) => {
    const r = parseJsonWithSourceMap(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain(message);
    expect(r.position).toEqual({ line, column });
  });

  it('agrees with JSON.parse on arbitrary JSON (property)', () => {
    fc.assert(
      fc.property(fc.json(), (json) => {
        const r = parseJsonWithSourceMap(json);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value).toEqual(JSON.parse(json));
      }),
    );
  });

  it('keeps "__proto__" as a plain key', () => {
    const r = parseJsonWithSourceMap('{"__proto__": {"x": 1}}');
    expect(r.ok && Object.keys(r.value as object)).toEqual(['__proto__']);
  });
});

describe('canonicalStringify', () => {
  it('orders keys by priority, then alphabetically, with provenance last', () => {
    const out = canonicalStringify({ provenance: {}, z: 1, id: 'x', a: [true, null], name: 'n' });
    expect(out).toBe(
      '{\n  "id": "x",\n  "name": "n",\n  "a": [\n    true,\n    null\n  ],\n  "z": 1,\n  "provenance": {}\n}\n',
    );
  });

  it('puts Game Model sections in their documented order', () => {
    expect(['gaps', 'meta', 'actions', 'entities'].sort(compareKeys)).toEqual([
      'meta',
      'entities',
      'actions',
      'gaps',
    ]);
  });

  it('omits undefined members and rejects non-finite numbers', () => {
    expect(canonicalStringify({ a: undefined, b: [] })).toBe('{\n  "b": []\n}\n');
    expect(() => canonicalStringify({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalStringify({ f: () => 1 })).toThrow(/Cannot serialize function/);
  });

  it('is independent of key insertion order and round-trips (property)', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        const text = canonicalStringify(obj);
        expect(canonicalStringify(reversed)).toBe(text);
        expect(canonicalStringify(JSON.parse(text))).toBe(text);
      }),
    );
  });
});

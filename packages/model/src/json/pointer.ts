/** RFC 6901 JSON Pointers. */

export function escapePointerSegment(segment: string | number): string {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

export function toPointer(path: readonly (string | number)[]): string {
  return path.map((s) => `/${escapePointerSegment(s)}`).join('');
}

export function parentPointer(pointer: string): string | undefined {
  if (pointer === '') return undefined;
  return pointer.slice(0, pointer.lastIndexOf('/'));
}

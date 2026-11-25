import { MAX_ID_LENGTH, idToKey } from '@gamex/model';

/** Turns any label into a valid kebab-case id ("S07 Laser Trial" → "s07-laser-trial"). */
export function toId(raw: string): string {
  let id = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (id === '') id = 'item';
  if (!/^[a-z]/.test(id)) id = `x-${id}`;
  if (id.length > MAX_ID_LENGTH) id = id.slice(0, MAX_ID_LENGTH).replace(/-+$/, '');
  return id;
}

/** Normalizes "prefix:Some Id" to "prefix:some-id"; returns undefined when the prefix is not allowed. */
export function toRef(raw: string, allowed: readonly string[]): string | undefined {
  const m = /^\s*([a-z]+)\s*:\s*(.+?)\s*$/.exec(raw);
  if (m === null) return undefined;
  const [, prefix = '', rest = ''] = m;
  return allowed.includes(prefix) ? `${prefix}:${toId(rest)}` : undefined;
}

export { idToKey };

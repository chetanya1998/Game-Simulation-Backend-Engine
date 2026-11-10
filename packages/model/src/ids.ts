/**
 * Node identifiers (ADR 0002 §2).
 *
 * Every Game Model node has a stable kebab-case `id` (e.g. `revives-used-this-mission`) and a
 * camelCase `key` derived from it (e.g. `revivesUsedThisMission`). Ids are what references and
 * provenance use; keys are what expressions, balance files, golden tests and game code use.
 */

/** Lowercase letters/digits in segments joined by single hyphens; must start with a letter. */
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const MAX_ID_LENGTH = 64;

export function isValidId(id: string): boolean {
  return id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id);
}

/**
 * Derives the camelCase key for a valid id: `s11-victory` → `s11Victory`,
 * `max-revives-per-mission` → `maxRevivesPerMission`.
 *
 * @throws {Error} if `id` is not a valid kebab-case id, with a hint on how to fix it.
 */
export function idToKey(id: string): string {
  if (!isValidId(id)) {
    throw new Error(
      `Invalid id "${id}": ids must be kebab-case (lowercase letters and digits separated by single hyphens, ` +
        `starting with a letter, at most ${String(MAX_ID_LENGTH)} characters), e.g. "max-revives-per-mission".`,
    );
  }
  return id.replace(/-([a-z0-9])/g, (_match, ch: string) => ch.toUpperCase());
}

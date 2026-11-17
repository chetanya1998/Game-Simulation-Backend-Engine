import { sha256Hex } from './hash.js';
import { canonicalStringify } from './json/canonical.js';
import type { GameModel } from './schema/game-model.js';

/** Hash of the model's content, ignoring version counters, timestamps and `$schema` (ARCHITECTURE §3.9). */
export function computeContentHash(model: GameModel): string {
  const volatile = new Set(['modelVersion', 'contentHash', 'createdAt', 'updatedAt']);
  const meta = Object.fromEntries(Object.entries(model.meta).filter(([k]) => !volatile.has(k)));
  const content = Object.fromEntries(Object.entries(model).filter(([k]) => k !== '$schema'));
  return sha256Hex(canonicalStringify({ ...content, meta }));
}

/** Canonical file content for game-model.json. */
export function serializeGameModel(model: GameModel): string {
  return canonicalStringify(model);
}

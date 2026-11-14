import { sha256Hex } from './hash.js';
import { canonicalStringify } from './json/canonical.js';
import type { GameModel } from './schema/game-model.js';

/** Hash of the model's content, ignoring version counters and timestamps (ARCHITECTURE §3.9). */
export function computeContentHash(model: GameModel): string {
  const volatile = new Set(['modelVersion', 'contentHash', 'createdAt', 'updatedAt']);
  const meta = Object.fromEntries(Object.entries(model.meta).filter(([k]) => !volatile.has(k)));
  return sha256Hex(canonicalStringify({ ...model, meta }));
}

/** Canonical file content for game-model.json. */
export function serializeGameModel(model: GameModel): string {
  return canonicalStringify(model);
}

// Writes packages/model/schema/game-model.schema.json from the built Zod schema.
// Run with `pnpm --filter @gamex/model gen:schema` (builds first). CI checks the file is up to date.
import { writeFileSync } from 'node:fs';
import { canonicalStringify, gameModelJsonSchema } from '../dist/index.js';

const target = new URL('../schema/game-model.schema.json', import.meta.url);
writeFileSync(target, canonicalStringify(gameModelJsonSchema()));
console.error(`wrote ${target.pathname}`);

import { z } from 'zod';
import { SCHEMA_VERSION } from './migrations.js';
import { GameModelSchema } from './schema/game-model.js';

export const JSON_SCHEMA_ID = 'https://gamex.dev/schema/game-model.schema.json';

/** JSON Schema (draft 2020-12) of game-model.json, generated from the Zod schema. */
export function gameModelJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(GameModelSchema, {
    target: 'draft-2020-12',
    io: 'input',
  }) as Record<string, unknown>;
  return {
    ...schema,
    $id: JSON_SCHEMA_ID,
    title: `GameX Engine Game Model (schema ${SCHEMA_VERSION})`,
    description: 'Canonical Game Model. Generated from @gamex/model — do not edit by hand.',
  };
}

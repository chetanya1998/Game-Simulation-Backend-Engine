import { readFileSync } from 'node:fs';
import type { GameModel } from '@gamex/model';

export function swarmRescue(): GameModel {
  return JSON.parse(
    readFileSync(
      new URL('../../../fixtures/swarm-rescue/swarm-rescue.game-model.json', import.meta.url),
      'utf8',
    ),
  ) as GameModel;
}

export { minimalModel } from '../../model/test/helpers/minimal-model.ts';

import { idToKey, type GameModel } from '@gamex/model';
import type { CAction } from '@gamex/engine';
import { constCase } from './common.js';

/** Every error code an action can return, in check order. */
export function errorCodesOf(a: CAction): string[] {
  const codes: string[] = [];
  if (a.preconditions.length > 0) codes.push(a.errorCode);
  for (const r of a.rules) if (r.blocking) codes.push(r.errorCode);
  for (const p of a.placements) {
    for (const r of p.rules) if (r.blocking) codes.push(r.errorCode);
    codes.push('PLACEMENT_NOT_ELIGIBLE');
  }
  for (const cost of a.costs) codes.push(`INSUFFICIENT_${constCase(cost.resourceId)}`);
  return [...new Set(codes)];
}

export function isRewarded(a: CAction): boolean {
  return a.placements.some((p) => p.format === 'rewarded');
}

export function isStore(a: CAction): boolean {
  return a.actor === 'store';
}

export function balanceFiles(model: GameModel): string[] {
  return [...new Set(model.constants.map((k) => k.balanceFile))].sort();
}

export function keyOf(id: string): string {
  return idToKey(id);
}

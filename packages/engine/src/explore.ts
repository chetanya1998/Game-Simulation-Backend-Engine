import type { GameModel } from '@gamex/model';
import { compileModel, type CompiledModel } from './compile.js';
import { searchExploits, type ExploitOptions, type ExploitReport } from './exploit.js';
import {
  analyzeReachability,
  type ReachabilityOptions,
  type ReachabilityReport,
} from './reachability.js';

export interface PlacementSafety {
  readonly placement: string;
  readonly format: string;
  readonly inWorld: boolean;
  /** Screens in which the placement can appear (its trigger screen, or the screens its action runs from). */
  readonly shownIn: readonly string[];
  readonly forbiddenHits: readonly string[];
  readonly safe: boolean;
}

/**
 * Static proof that no UI ad can appear in a forbidden screen: a placement appears only on entering its
 * trigger screen, or when its trigger action runs from one of the screens offering that action.
 */
export function checkPlacementSafety(input: GameModel | CompiledModel): PlacementSafety[] {
  const c = 'transitionsFrom' in input ? input : compileModel(input);
  return [...c.placements.values()].map((p) => {
    const shownIn =
      p.triggerState !== undefined
        ? [p.triggerState]
        : [
            ...new Set(
              c.transitions
                .filter(
                  (t) => t.trigger.kind === 'action' && t.trigger.actionId === p.triggerAction,
                )
                .map((t) => t.from),
            ),
          ].sort();
    const forbiddenHits = p.inWorld ? [] : shownIn.filter((s) => p.forbidden.has(s));
    return {
      placement: p.id,
      format: p.format,
      inWorld: p.inWorld,
      shownIn,
      forbiddenHits,
      safe: forbiddenHits.length === 0,
    };
  });
}

export interface ExploreReport {
  readonly reachability: ReachabilityReport;
  readonly exploits: ExploitReport;
  readonly placements: readonly PlacementSafety[];
  /** True when there is no error-level reachability issue, no blocking exploit finding and no unsafe placement. */
  readonly ok: boolean;
}

export function explore(
  model: GameModel,
  options: { readonly reachability?: ReachabilityOptions; readonly exploits?: ExploitOptions } = {},
): ExploreReport {
  const c = compileModel(model);
  const reachability = analyzeReachability(c, options.reachability);
  const exploits = searchExploits(c, options.exploits);
  const placements = checkPlacementSafety(c);
  const ok =
    !reachability.issues.some((i) => i.severity === 'error') &&
    !exploits.findings.some((f) => f.severity === 'blocking') &&
    placements.every((p) => p.safe);
  return { reachability, exploits, placements, ok };
}

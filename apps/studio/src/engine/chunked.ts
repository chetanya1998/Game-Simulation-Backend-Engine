import {
  aggregateResults,
  type PlayerSummary,
  type SimulationOptions,
  type SimulationResult,
} from '@gamex/engine';
import type { GameModel } from '@gamex/model';

/** Splits players [0, n) into at most `parts` contiguous ranges. */
export function planChunks(players: number, parts: number): { from: number; to: number }[] {
  const n = Math.max(1, Math.min(parts, players));
  const out: { from: number; to: number }[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((players * i) / n);
    const to = Math.floor((players * (i + 1)) / n);
    if (to > from) out.push({ from, to });
  }
  return out;
}

/**
 * Runs a simulation as independent player ranges (one per worker task) and merges them. Each player has
 * its own seeded stream, so the result — and its outputHash — is identical to runSimulation's in the CLI.
 */
export async function runChunked(
  model: GameModel,
  options: SimulationOptions,
  parts: number,
  simulate: (options: SimulationOptions) => Promise<PlayerSummary[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<SimulationResult> {
  const chunks = planChunks(options.playersPerPersona, parts);
  let done = 0;
  const results = await Promise.all(
    chunks.map(async (playerRange) => {
      const players = await simulate({ ...options, playerRange });
      done++;
      onProgress?.(done, chunks.length);
      return players;
    }),
  );
  return aggregateResults(model, options, results.flat());
}

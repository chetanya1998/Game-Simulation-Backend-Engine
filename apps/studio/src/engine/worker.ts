import * as Comlink from 'comlink';
import {
  analyzeReachability,
  explore,
  sensitivity,
  simulatePlayers,
  type SimulationOptions,
} from '@gamex/engine';
import type { GameModel } from '@gamex/model';
import { renderSpecPack, type SpecPackOptions } from '@gamex/specpack';

/** The engine, running off the main thread. Everything here is pure and deterministic. */
const api = {
  simulatePlayers(model: GameModel, options: SimulationOptions) {
    return simulatePlayers(model, options);
  },
  reachability(model: GameModel) {
    return analyzeReachability(model);
  },
  explore(model: GameModel) {
    return explore(model);
  },
  sensitivity(model: GameModel, options: Omit<SimulationOptions, 'params'>) {
    return sensitivity(model, options);
  },
  renderPack(model: GameModel, options: SpecPackOptions) {
    const pack = renderSpecPack(model, options);
    return {
      files: [...pack.files].map(([path, f]) => ({
        path,
        content: f.content,
        ownership: f.ownership,
      })),
      agentsSection: pack.agentsSection,
      goldenCases: pack.goldens.reduce((n, g) => n + g.cases.length, 0),
      outputHash: pack.simulation.record.outputHash,
    };
  },
};

export type EngineApi = typeof api;

Comlink.expose(api);

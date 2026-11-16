// Bundled into a Web Worker by browser-determinism.test.ts.
import type { GameModel } from '@gamex/model';
import { analyzeReachability, runSimulation } from '@gamex/engine';

declare const self: {
  onmessage: ((e: { data: GameModel }) => void) | null;
  postMessage: (v: unknown) => void;
};

self.onmessage = (e) => {
  const sim = runSimulation(e.data, { seed: 99, days: 3, playersPerPersona: 8 });
  const reach = analyzeReachability(e.data);
  self.postMessage({
    outputHash: sim.record.outputHash,
    witnesses: Object.keys(reach.witnesses).length,
    explored: reach.explored.nodes,
  });
};

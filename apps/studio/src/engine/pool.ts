import * as Comlink from 'comlink';
import type { SimulationOptions, SimulationResult } from '@gamex/engine';
import type { GameModel } from '@gamex/model';
import { runChunked } from './chunked.ts';
import type { EngineApi } from './worker.ts';

interface Slot {
  worker: Worker;
  api: Comlink.Remote<EngineApi>;
  busy: boolean;
}

/** A small pool of engine Web Workers. */
export class EnginePool {
  private readonly slots: Slot[] = [];
  private readonly waiting: ((slot: Slot) => void)[] = [];

  constructor(readonly size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))) {}

  private slot(): Promise<Slot> {
    const free = this.slots.find((s) => !s.busy);
    if (free !== undefined) {
      free.busy = true;
      return Promise.resolve(free);
    }
    if (this.slots.length < this.size) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const s: Slot = { worker, api: Comlink.wrap<EngineApi>(worker), busy: true };
      this.slots.push(s);
      return Promise.resolve(s);
    }
    return new Promise((ok) => this.waiting.push(ok));
  }

  private release(s: Slot): void {
    const next = this.waiting.shift();
    if (next !== undefined) next(s);
    else s.busy = false;
  }

  async run<T>(fn: (api: Comlink.Remote<EngineApi>) => Promise<T>): Promise<T> {
    const s = await this.slot();
    try {
      return await fn(s.api);
    } finally {
      this.release(s);
    }
  }

  simulate(
    model: GameModel,
    options: SimulationOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<SimulationResult> {
    return runChunked(
      model,
      options,
      this.size * 2,
      (o) => this.run((w) => w.simulatePlayers(model, o)),
      onProgress,
    );
  }

  terminate(): void {
    for (const s of this.slots) s.worker.terminate();
    this.slots.length = 0;
  }
}

let shared: EnginePool | undefined;
export function pool(): EnginePool {
  shared ??= new EnginePool();
  return shared;
}

import { build } from 'esbuild';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { analyzeReachability, runSimulation } from '@gamex/engine';
import { swarmRescue } from './helpers.ts';

/**
 * Determinism across runtimes: the same model and seed must give byte-identical results in Node and in a
 * browser Web Worker (a different JavaScript engine build, no Node APIs). Runs in CI; locally it is skipped
 * only when no Chromium is installed and CI is not set.
 */
async function browserAvailable(): Promise<boolean> {
  try {
    const browser = await chromium.launch();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const available = process.env['CI'] !== undefined || (await browserAvailable());

describe.skipIf(!available)('browser determinism', () => {
  it('gives the same output hash in a Chromium Web Worker as in Node', async () => {
    const model = swarmRescue();
    const node = runSimulation(model, { seed: 99, days: 3, playersPerPersona: 8 });
    const reach = analyzeReachability(model);

    const bundle = await build({
      entryPoints: [new URL('./browser/entry.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      conditions: ['@gamex/source'],
      logLevel: 'silent',
    });
    const code = bundle.outputFiles[0]?.text ?? '';

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const result = await page.evaluate(
        async ({ code, model }) => {
          const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
          // Runs in the page, where Worker is a global.
          const WorkerCtor = (
            globalThis as unknown as {
              Worker: new (u: string) => {
                onmessage: (e: { data: unknown }) => void;
                onerror: (e: { message: string }) => void;
                postMessage: (m: unknown) => void;
              };
            }
          ).Worker;
          const worker = new WorkerCtor(url);
          return await new Promise<unknown>((resolve, reject) => {
            worker.onmessage = (e) => {
              resolve(e.data);
            };
            worker.onerror = (e) => {
              reject(new Error(e.message));
            };
            worker.postMessage(model);
          });
        },
        { code, model },
      );
      expect(result).toEqual({
        outputHash: node.record.outputHash,
        witnesses: Object.keys(reach.witnesses).length,
        explored: reach.explored.nodes,
      });
    } finally {
      await browser.close();
    }
  }, 60000);
});

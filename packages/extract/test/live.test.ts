import { describe, expect, it } from 'vitest';
import { AnthropicProvider, assembleCandidate, resolveModel, runExtraction } from '@gamex/extract';
import { discoverInputs, readChunks } from '@gamex/ingest';
import { validateGameModel } from '@gamex/model';

const SAMPLE = new URL('../../../fixtures/swarm-rescue/sample-repo/', import.meta.url).pathname;

/** Opt-in: GAMEX_LIVE=1 ANTHROPIC_API_KEY=… pnpm --filter @gamex/extract test test/live.test.ts */
describe.runIf(process.env['GAMEX_LIVE'] === '1')('live extraction (Anthropic API)', () => {
  it(
    'extracts a valid candidate from the Swarm Rescue sample repo',
    { timeout: 30 * 60_000 },
    async () => {
      const chunks = await readChunks(discoverInputs(SAMPLE));
      const { model } = resolveModel({ env: process.env['GAMEX_MODEL'] });
      const run = await runExtraction(chunks, new AnthropicProvider({ model }), {
        onProgress: (m) => process.stderr.write(`${m}\n`),
      });
      const candidate = assembleCandidate(run.outputs, chunks);
      expect(validateGameModel(candidate.model).ok).toBe(true);
      const formats = new Set(candidate.model.monetization.placements.map((p) => p.format));
      expect([...formats]).toEqual(
        expect.arrayContaining(['rewarded', 'interstitial', 'banner', 'mrec']),
      );
      process.stderr.write(
        `${JSON.stringify({ usage: run.usage, counts: candidate.report.counts, unverified: candidate.report.unverified.length })}\n`,
      );
    },
  );
});

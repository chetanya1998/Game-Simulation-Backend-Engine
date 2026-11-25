/**
 * Maintains the recorded extraction answers for Swarm Rescue (fixtures/swarm-rescue/recordings/).
 *
 *   pnpm --filter @gamex/fixtures record          re-hash the recordings after prompts or inputs change
 *   pnpm --filter @gamex/fixtures record --live   record real answers from the Anthropic API into
 *                                                 recordings-live/ (needs ANTHROPIC_API_KEY; GAMEX_MODEL)
 *
 * The committed recordings are *authored*: written by hand (from the hand-made Swarm Rescue model) as
 * stand-ins for LLM answers, so the deterministic pipeline can be tested offline. Their "origin" says so.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AnthropicProvider,
  RecordedProvider,
  RecordingProvider,
  resolveModel,
  runExtraction,
  type Recording,
} from '@gamex/extract';
import { discoverInputs, readChunks } from '@gamex/ingest';

const here = new URL('../swarm-rescue/', import.meta.url).pathname;
const repo = join(here, 'sample-repo');
const chunks = await readChunks(discoverInputs(repo));

if (process.argv.includes('--live')) {
  const { model } = resolveModel({ env: process.env['GAMEX_MODEL'] });
  const provider = new RecordingProvider(
    new AnthropicProvider({ model }),
    join(here, 'recordings-live'),
  );
  const run = await runExtraction(chunks, provider, {
    onProgress: (m) => process.stderr.write(`${m}\n`),
  });
  process.stderr.write(
    `recorded ${String(run.requests.length)} answers with ${model}: ${JSON.stringify(run.usage)}\n`,
  );
} else {
  const dir = join(here, 'recordings');
  const provider = RecordedProvider.fromDirectory(dir, { ignoreHash: true });
  await runExtraction(chunks, provider);
  for (const request of provider.requests) {
    const file = join(dir, `${request.id.replace('#', '-')}.json`);
    const rec = JSON.parse(readFileSync(file, 'utf8')) as Recording;
    if (rec.requestHash !== request.hash) {
      writeFileSync(file, `${JSON.stringify({ ...rec, requestHash: request.hash }, null, 2)}\n`);
      process.stderr.write(`re-hashed ${request.id}\n`);
    }
  }
}

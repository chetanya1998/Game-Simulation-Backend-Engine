/**
 * Maintains the recorded extraction answers for Swarm Rescue.
 *
 *   pnpm --filter @gamex/fixtures record          re-hash the recordings after prompts or inputs change
 *   pnpm --filter @gamex/fixtures record --live   record real answers from the Anthropic API into
 *                                                 recordings-live/ (needs ANTHROPIC_API_KEY; GAMEX_MODEL)
 *
 * Scenarios:
 *   recordings/         the sample repo as committed (GDD at docs/GDD.md)
 *   recordings-upload/  the sample repo without docs/GDD.md, with the GDD uploaded through the studio
 *                       to gamex/sources/GDD.md (derived from recordings/ by rewriting the path)
 *
 * The committed recordings are *authored*: written by hand (from the hand-made Swarm Rescue model) as
 * stand-ins for LLM answers, so the deterministic pipeline can be tested offline. Their "origin" says so.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
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
import { uploadScenarioRepo } from './scenarios.ts';

const here = new URL('../swarm-rescue/', import.meta.url).pathname;
const sample = join(here, 'sample-repo');

async function rehash(repo: string, dir: string): Promise<void> {
  const chunks = await readChunks(discoverInputs(repo));
  const provider = RecordedProvider.fromDirectory(dir, { ignoreHash: true });
  await runExtraction(chunks, provider);
  for (const request of provider.requests) {
    const file = join(dir, `${request.id.replace('#', '-')}.json`);
    const rec = JSON.parse(readFileSync(file, 'utf8')) as Recording;
    if (rec.requestHash !== request.hash) {
      writeFileSync(file, `${JSON.stringify({ ...rec, requestHash: request.hash }, null, 2)}\n`);
      process.stderr.write(`re-hashed ${dir.split('/').at(-1) ?? dir}/${request.id}\n`);
    }
  }
}

if (process.argv.includes('--live')) {
  const chunks = await readChunks(discoverInputs(sample));
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
  const base = join(here, 'recordings');
  await rehash(sample, base);
  const upload = join(here, 'recordings-upload');
  mkdirSync(upload, { recursive: true });
  for (const file of readdirSync(base).filter((f) => f.endsWith('.json'))) {
    const text = readFileSync(join(base, file), 'utf8').replaceAll(
      '"docs/GDD.md#',
      '"gamex/sources/GDD.md#',
    );
    const previous = (() => {
      try {
        return JSON.parse(readFileSync(join(upload, file), 'utf8')) as Recording;
      } catch {
        return undefined;
      }
    })();
    const rec = JSON.parse(text) as Recording;
    writeFileSync(
      join(upload, file),
      `${JSON.stringify({ ...rec, requestHash: previous?.requestHash ?? '' }, null, 2)}\n`,
    );
  }
  await rehash(uploadScenarioRepo(), upload);
}

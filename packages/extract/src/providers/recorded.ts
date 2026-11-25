import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from '../provider.js';

/** A recorded answer: the hash of the request it answers, and the answer. */
export const RecordingSchema = z.strictObject({
  id: z.string(),
  requestHash: z.string(),
  /** "authored" (written by hand as a stand-in for an LLM answer) or the model that produced it. */
  origin: z.string(),
  response: z.unknown(),
});
export type Recording = z.infer<typeof RecordingSchema>;

export function loadRecordings(directory: string): Map<string, Recording> {
  const out = new Map<string, Recording>();
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const rec = RecordingSchema.parse(JSON.parse(readFileSync(join(directory, file), 'utf8')));
    out.set(rec.id, rec);
  }
  return out;
}

export interface RecordedProviderOptions {
  /** Accept a recording whose request hash no longer matches (used by the re-hash script only). */
  readonly ignoreHash?: boolean;
}

/**
 * Replays recorded answers keyed by request id and records every request it is given, so tests can
 * assert on exactly what would have been sent to an LLM.
 */
export class RecordedProvider implements LlmProvider {
  readonly name = 'recorded';
  readonly requests: LlmRequest[] = [];

  constructor(
    private readonly recordings: ReadonlyMap<string, Recording>,
    private readonly options: RecordedProviderOptions = {},
  ) {}

  static fromDirectory(directory: string, options?: RecordedProviderOptions): RecordedProvider {
    return new RecordedProvider(loadRecordings(directory), options);
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const rec = this.recordings.get(request.id);
    if (rec === undefined) {
      return Promise.reject(new LlmError(`No recording for request ${request.id}.`, request.id));
    }
    if (rec.requestHash !== request.hash && this.options.ignoreHash !== true) {
      return Promise.reject(
        new LlmError(
          `The recording for ${request.id} answers a different request (the inputs or prompts changed). ` +
            `Re-record it, or re-hash authored recordings with \`pnpm --filter @gamex/fixtures record\`.`,
          request.id,
        ),
      );
    }
    return Promise.resolve({ text: JSON.stringify(rec.response), model: rec.origin });
  }
}

/** Wraps a live provider and saves each validated answer as a recording. */
export class RecordingProvider implements LlmProvider {
  readonly name: string;

  constructor(
    private readonly inner: LlmProvider,
    private readonly directory: string,
  ) {
    this.name = `${inner.name}+recording`;
  }

  async complete(request: LlmRequest, schema: z.ZodType): Promise<LlmResponse> {
    const response = await this.inner.complete(request, schema);
    const parsed = schema.safeParse(safeJson(response.text));
    if (parsed.success) {
      if (!existsSync(this.directory)) mkdirSync(this.directory, { recursive: true });
      const rec: Recording = {
        id: request.id,
        requestHash: request.hash,
        origin: response.model ?? this.inner.name,
        response: parsed.data,
      };
      writeFileSync(
        join(this.directory, `${request.id.replace('#', '-')}.json`),
        `${JSON.stringify(rec, null, 2)}\n`,
      );
    }
    return response;
  }
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

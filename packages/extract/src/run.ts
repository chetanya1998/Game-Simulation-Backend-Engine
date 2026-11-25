import type { Chunk } from '@gamex/ingest';
import type { z } from 'zod';
import { idToKey, toId } from './ids.js';
import { SYSTEM_PROMPT, renderDocuments, renderInstructions } from './prompts.js';
import {
  HandoffPending,
  LlmError,
  requestHash,
  type LlmProvider,
  type LlmRequest,
  type LlmUsage,
} from './provider.js';
import { safeJson } from './providers/recorded.js';
import { PASSES, PASS_SCHEMAS, type PassName, type PassOutputs } from './schemas.js';

export const DEFAULT_BATCH_CHARS = 400_000;
export const DEFAULT_MAX_RETRIES = 2;

export interface ExtractOptions {
  /** Maximum characters of documents per request; larger inputs are split into batches. */
  readonly batchChars?: number;
  readonly maxRetries?: number;
  /** Refuse to start when the estimated input tokens exceed this. */
  readonly budgetTokens?: number;
  readonly onProgress?: (message: string) => void;
}

export interface RequestLogEntry {
  readonly id: string;
  readonly hash: string;
  readonly attempts: number;
  readonly model?: string;
  readonly usage?: LlmUsage;
}

export interface ExtractionRun {
  readonly provider: string;
  readonly outputs: PassOutputs;
  readonly requests: readonly RequestLogEntry[];
  readonly usage: LlmUsage;
}

export interface ExtractionEstimate {
  readonly batches: number;
  readonly requests: number;
  /** Rough input tokens over all requests (characters / 4), before caching. */
  readonly inputTokens: number;
}

export class BudgetExceeded extends Error {
  constructor(
    readonly estimate: ExtractionEstimate,
    readonly budget: number,
  ) {
    super(
      `The extraction needs about ${String(estimate.inputTokens)} input tokens over ${String(estimate.requests)} requests, ` +
        `more than the budget of ${String(budget)}. Exclude files (.gamexignore or --include) or raise --budget.`,
    );
    this.name = 'BudgetExceeded';
  }
}

/** Splits chunks into batches of at most `maxChars` characters of text, keeping their order. */
export function batchChunks(chunks: readonly Chunk[], maxChars = DEFAULT_BATCH_CHARS): Chunk[][] {
  const batches: Chunk[][] = [];
  let current: Chunk[] = [];
  let size = 0;
  for (const c of chunks) {
    if (current.length > 0 && size + c.text.length > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(c);
    size += c.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function estimateExtraction(
  chunks: readonly Chunk[],
  options: ExtractOptions = {},
): ExtractionEstimate {
  const batches = batchChunks(chunks, options.batchChars);
  const perPassOverhead = SYSTEM_PROMPT.length + 4000;
  const chars =
    batches.reduce((sum, b) => sum + renderDocuments(b).length + perPassOverhead, 0) *
    PASSES.length;
  return {
    batches: batches.length,
    requests: batches.length * PASSES.length,
    inputTokens: Math.ceil(chars / 4),
  };
}

/** Lines describing what earlier passes proposed, so later passes reference the same ids and keys. */
export function knownItems(outputs: PassOutputs, upTo: PassName): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (prefix: string, rawId: string, detail: string): void => {
    const id = toId(rawId);
    const line = `${prefix}:${id} (${idToKey(id)})${detail}`;
    if (!seen.has(`${prefix}:${id}`)) {
      seen.add(`${prefix}:${id}`);
      lines.push(line);
    }
  };
  const order = PASSES.indexOf(upTo);
  const constants = [
    ...outputs.inventory.flatMap((o) => o.constants),
    ...outputs.flow.flatMap((o) => o.constants),
    ...outputs.monetization.flatMap((o) => o.constants),
  ];
  const variables = [
    ...outputs.inventory.flatMap((o) => o.variables),
    ...outputs.flow.flatMap((o) => o.variables),
    ...outputs.monetization.flatMap((o) => o.variables),
  ];
  for (const o of outputs.inventory) {
    for (const e of o.entities) add('ent', e.id, ` — ${e.kind}`);
    for (const r of o.resources) add('res', r.id, ` — ${r.kind} resource`);
  }
  for (const c of constants)
    add(
      'const',
      c.id,
      c.value === null
        ? c.curve === null
          ? ''
          : ` = ${c.curve.type} curve`
        : ` = ${String(c.value)}`,
    );
  for (const v of variables)
    add(
      'var',
      v.id,
      ` — ${v.scope} ${v.type}${v.enumValues === null ? '' : ` (${v.enumValues.map((x) => `"${x}"`).join(', ')})`}`,
    );
  if (order >= 2) {
    for (const o of outputs.flow) {
      for (const s of o.states) add('state', s.id, ` — ${s.kind}`);
      for (const a of o.actions)
        add(
          'action',
          a.id,
          a.outcomes.length > 0 ? ` — outcomes ${a.outcomes.map((x) => x.id).join('/')}` : '',
        );
    }
  }
  if (order >= 3) {
    for (const o of outputs.monetization) {
      for (const p of o.placements) add('placement', p.id, ` — ${p.format}`);
      for (const r of o.rules) add('rule', r.id, '');
    }
  }
  return lines;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 30)
    .map((i) => `- at /${i.path.map(String).join('/')}: ${i.message}`)
    .join('\n');
}

const ZERO: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function addUsage(a: LlmUsage, b: LlmUsage | undefined): LlmUsage {
  if (b === undefined) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/**
 * Runs passes inventory → flow → monetization → gaps over every batch of chunks. Each answer is
 * validated against the pass schema; an invalid answer is retried (up to `maxRetries`) with the
 * validation errors fed back. Later passes see the ids proposed by earlier ones.
 */
export async function runExtraction(
  chunks: readonly Chunk[],
  provider: LlmProvider,
  options: ExtractOptions = {},
): Promise<ExtractionRun> {
  const estimate = estimateExtraction(chunks, options);
  if (options.budgetTokens !== undefined && estimate.inputTokens > options.budgetTokens) {
    throw new BudgetExceeded(estimate, options.budgetTokens);
  }
  const batches = batchChunks(chunks, options.batchChars);
  const documents = batches.map((b) => renderDocuments(b));
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const outputs: PassOutputs = { inventory: [], flow: [], monetization: [], gaps: [] };
  const log: RequestLogEntry[] = [];
  let usage = ZERO;

  for (const pass of PASSES) {
    const schema = PASS_SCHEMAS[pass];
    const instructions = renderInstructions(pass, { known: knownItems(outputs, pass) });
    const pending: string[] = [];
    let handoffDir = '';
    for (const [index, docs] of documents.entries()) {
      const id = `${pass}#${String(index + 1)}`;
      const hash = requestHash({ pass, system: SYSTEM_PROMPT, documents: docs, instructions });
      options.onProgress?.(`extract ${id}`);
      let feedback: LlmRequest['feedback'];
      for (let attempt = 0; ; attempt++) {
        const request: LlmRequest = {
          id,
          pass,
          batch: index + 1,
          system: SYSTEM_PROMPT,
          documents: docs,
          instructions,
          hash,
          attempt,
          ...(feedback === undefined ? {} : { feedback }),
        };
        let text: string;
        try {
          const response = await provider.complete(request, schema);
          usage = addUsage(usage, response.usage);
          text = response.text;
          const parsed = schema.safeParse(safeJson(text));
          if (parsed.success) {
            (outputs[pass] as unknown[]).push(parsed.data);
            log.push({
              id,
              hash,
              attempts: attempt + 1,
              ...(response.model === undefined ? {} : { model: response.model }),
              ...(response.usage === undefined ? {} : { usage: response.usage }),
            });
            break;
          }
          const errors =
            safeJson(text) === undefined
              ? '- the answer is not valid JSON'
              : formatZodError(parsed.error);
          if (attempt >= maxRetries) {
            throw new LlmError(
              `The answer to ${id} still failed validation after ${String(attempt + 1)} attempts:\n${errors}`,
              id,
            );
          }
          feedback = { previous: text, errors };
        } catch (error) {
          if (error instanceof HandoffPending) {
            pending.push(...error.pending);
            handoffDir = error.directory;
            break;
          }
          throw error;
        }
      }
    }
    if (pending.length > 0) throw new HandoffPending(pending, handoffDir);
  }
  return { provider: provider.name, outputs, requests: log, usage };
}

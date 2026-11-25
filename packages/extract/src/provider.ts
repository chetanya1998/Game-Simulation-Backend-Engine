import { canonicalStringify, sha256Hex } from '@gamex/model';
import type { z } from 'zod';
import { PROMPT_VERSION } from './prompts.js';
import type { PassName } from './schemas.js';

/** One structured-output request. Everything an LLM (or a human agent) needs to answer it. */
export interface LlmRequest {
  /** "<pass>#<batch>", e.g. "inventory#1". Stable across runs; used to name recordings and handoff files. */
  readonly id: string;
  readonly pass: PassName;
  readonly batch: number;
  readonly system: string;
  /** The documents block (identical for every pass of a batch, so providers can cache it). */
  readonly documents: string;
  readonly instructions: string;
  /** SHA-256 over system, documents and instructions: identifies the exact request content. */
  readonly hash: string;
  /** 0 for the first attempt; retries carry the previous answer and what was wrong with it. */
  readonly attempt: number;
  readonly feedback?: { readonly previous: string; readonly errors: string };
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface LlmResponse {
  /** The JSON text of the answer. */
  readonly text: string;
  readonly model?: string;
  readonly usage?: LlmUsage;
}

export interface LlmProvider {
  /** "anthropic", "recorded", "agent", … — shown in reports. */
  readonly name: string;
  complete(request: LlmRequest, schema: z.ZodType): Promise<LlmResponse>;
}

/** The provider could not produce an answer (network, API, refusal, truncation). CLI exit code 3. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly requestId: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Agent-handoff requests were written and are waiting for answers. */
export class HandoffPending extends Error {
  constructor(
    readonly pending: readonly string[],
    readonly directory: string,
  ) {
    super(
      `${String(pending.length)} extraction request(s) are waiting for an answer in ${directory}/requests/. ` +
        `Answer each one in ${directory}/responses/<id>.json, then run the command again.`,
    );
    this.name = 'HandoffPending';
  }
}

export function requestHash(parts: {
  pass: PassName;
  system: string;
  documents: string;
  instructions: string;
}): string {
  return sha256Hex(canonicalStringify({ promptVersion: PROMPT_VERSION, ...parts }));
}

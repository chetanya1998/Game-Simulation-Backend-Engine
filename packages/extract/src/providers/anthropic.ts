import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from '../provider.js';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicProviderOptions {
  readonly model: string;
  /** Defaults to the ANTHROPIC_API_KEY environment variable (read by the SDK). */
  readonly apiKey?: string;
  readonly effort?: Effort;
  readonly maxTokens?: number;
  /** Server-side fallback to another model when the requested one is overloaded (default on). */
  readonly serverFallbacks?: boolean;
  /** For tests: a preconfigured client. */
  readonly client?: Anthropic;
}

/**
 * Claude via the Messages API: structured outputs from the pass's Zod schema, streaming (long
 * inputs), the documents block marked for prompt caching (shared by all four passes), and
 * server-side fallbacks so an overloaded model does not fail the run.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.client =
      options.client ??
      new Anthropic(options.apiKey === undefined ? {} : { apiKey: options.apiKey });
  }

  async complete(request: LlmRequest, schema: z.ZodType): Promise<LlmResponse> {
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: request.documents, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: request.instructions },
        ],
      },
    ];
    if (request.feedback !== undefined) {
      messages.push(
        { role: 'assistant', content: request.feedback.previous },
        {
          role: 'user',
          content: `That answer failed validation:\n${request.feedback.errors}\nReturn the corrected JSON.`,
        },
      );
    }
    let message: Anthropic.Beta.Messages.BetaMessage;
    try {
      const stream = this.client.beta.messages.stream({
        model: this.options.model,
        max_tokens: this.options.maxTokens ?? 64000,
        ...(this.options.serverFallbacks === false
          ? {}
          : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
        output_config: {
          effort: this.options.effort ?? 'high',
          format: betaZodOutputFormat(schema),
        },
        system: request.system,
        messages,
      });
      message = await stream.finalMessage();
    } catch (error) {
      throw toLlmError(error, request.id);
    }
    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category ?? 'unspecified';
      throw new LlmError(
        `The model declined request ${request.id} (category: ${category}).`,
        request.id,
      );
    }
    if (message.stop_reason === 'max_tokens') {
      throw new LlmError(
        `The answer to ${request.id} was cut off at max_tokens; split the input into smaller batches (--batch-chars) or raise --max-tokens.`,
        request.id,
      );
    }
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    const usage = message.usage;
    return {
      text,
      model: message.model,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

function toLlmError(error: unknown, id: string): LlmError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new LlmError('The Anthropic API rejected the API key (set ANTHROPIC_API_KEY).', id);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmError('Rate limited by the Anthropic API; try again later.', id, true);
  }
  if (error instanceof Anthropic.APIError) {
    return new LlmError(`Anthropic API error ${String(error.status)}: ${error.message}`, id, true);
  }
  return new LlmError(
    `Request ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
    id,
    true,
  );
}

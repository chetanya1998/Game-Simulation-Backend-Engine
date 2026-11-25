import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  AgentHandoffProvider,
  AnthropicProvider,
  BudgetExceeded,
  HandoffPending,
  LlmError,
  RecordedProvider,
  RecordingProvider,
  batchChunks,
  estimateExtraction,
  knownItems,
  loadRecordings,
  runExtraction,
  type LlmProvider,
  type LlmRequest,
  type PassName,
} from '@gamex/extract';
import { CHUNKS, tinyOutputs } from './helpers.js';

/** Answers from tinyOutputs(), optionally broken on the first attempt of one pass. */
class ScriptedProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly requests: LlmRequest[] = [];
  constructor(private readonly badFirst?: { pass: PassName; text: string; times?: number }) {}
  complete(request: LlmRequest) {
    this.requests.push(request);
    const outputs = tinyOutputs();
    if (this.badFirst?.pass === request.pass && request.attempt < (this.badFirst.times ?? 1)) {
      return Promise.resolve({ text: this.badFirst.text });
    }
    const answer = outputs[request.pass][0];
    return Promise.resolve({
      text: JSON.stringify(answer),
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 8, cacheWriteTokens: 2 },
    });
  }
}

describe('runExtraction', () => {
  it('runs the four passes in order, sharing the documents and passing known ids forward', async () => {
    const provider = new ScriptedProvider();
    const run = await runExtraction(CHUNKS, provider);
    expect(provider.requests.map((r) => r.id)).toEqual([
      'inventory#1',
      'flow#1',
      'monetization#1',
      'gaps#1',
    ]);
    expect(new Set(provider.requests.map((r) => r.documents)).size).toBe(1);
    expect(provider.requests[0]?.documents).toContain(
      '<chunk id="docs/design.md#L10-13" path="docs/design.md" kind="design" lines="10-13" heading="3. Ads">',
    );
    expect(provider.requests[1]?.instructions).toContain('const:max-revives (maxRevives) = 2');
    expect(provider.requests[1]?.instructions).not.toContain('state:');
    expect(provider.requests[3]?.instructions).toContain(
      'placement:rewarded-revive (rewardedRevive) — rewarded',
    );
    expect(run.usage).toEqual({
      inputTokens: 40,
      outputTokens: 20,
      cacheReadTokens: 32,
      cacheWriteTokens: 8,
    });
    expect(run.outputs.flow[0]?.actions).toHaveLength(3);
  });

  it('retries an invalid answer with the validation errors, then gives up', async () => {
    const provider = new ScriptedProvider({ pass: 'flow', text: '{"states": 3}' });
    const run = await runExtraction(CHUNKS, provider);
    const flow = provider.requests.filter((r) => r.pass === 'flow');
    expect(flow.map((r) => r.attempt)).toEqual([0, 1]);
    expect(flow[1]?.feedback?.errors).toMatch(/at \/states: .*array/);
    expect(flow[1]?.hash).toBe(flow[0]?.hash);
    expect(run.requests.find((r) => r.id === 'flow#1')?.attempts).toBe(2);

    const stubborn = new ScriptedProvider({ pass: 'gaps', text: 'not json', times: 9 });
    await expect(runExtraction(CHUNKS, stubborn)).rejects.toThrow(
      /gaps#1 still failed validation after 3 attempts:\n- the answer is not valid JSON/,
    );
  });

  it('splits large inputs into batches and enforces the budget', async () => {
    expect(batchChunks(CHUNKS, 50).map((b) => b.map((c) => c.id))).toEqual([
      ['docs/design.md#L10-13'],
      ['config/game.json#L1-4'],
    ]);
    const estimate = estimateExtraction(CHUNKS, { batchChars: 50 });
    expect(estimate).toMatchObject({ batches: 2, requests: 8 });
    await expect(
      runExtraction(CHUNKS, new ScriptedProvider(), { budgetTokens: 100 }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
    const provider = new ScriptedProvider();
    const run = await runExtraction(CHUNKS, provider, { batchChars: 50 });
    expect(provider.requests.map((r) => r.id)).toEqual([
      'inventory#1',
      'inventory#2',
      'flow#1',
      'flow#2',
      'monetization#1',
      'monetization#2',
      'gaps#1',
      'gaps#2',
    ]);
    expect(run.outputs.inventory).toHaveLength(2);
  });

  it('lists known items once each', () => {
    const known = knownItems(tinyOutputs(), 'gaps');
    expect(known.filter((l) => l.startsWith('const:max-revives '))).toHaveLength(1);
    expect(known).toContain('var:last-result (lastResult) — player enum ("none", "win", "lose")');
    expect(known).toContain('action:play-run (playRun) — outcomes win/lose');
  });
});

describe('recorded providers', () => {
  it('records answers and replays them, refusing stale recordings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gamex-rec-'));
    await runExtraction(CHUNKS, new RecordingProvider(new ScriptedProvider(), dir));
    expect(readdirSync(dir).sort()).toEqual([
      'flow-1.json',
      'gaps-1.json',
      'inventory-1.json',
      'monetization-1.json',
    ]);
    expect(loadRecordings(dir).get('flow#1')).toMatchObject({ origin: 'scripted', id: 'flow#1' });

    const replay = RecordedProvider.fromDirectory(dir);
    const run = await runExtraction(CHUNKS, replay);
    expect(run.outputs).toEqual(
      await runExtraction(CHUNKS, new ScriptedProvider()).then((r) => r.outputs),
    );

    const changed = CHUNKS.map((c) => ({ ...c, text: `${c.text}\nchanged` }));
    await expect(runExtraction(changed, RecordedProvider.fromDirectory(dir))).rejects.toThrow(
      /answers a different request/,
    );
    await expect(runExtraction(CHUNKS, new RecordedProvider(new Map()))).rejects.toThrow(
      /No recording for request inventory#1/,
    );
    expect(
      (await runExtraction(changed, RecordedProvider.fromDirectory(dir, { ignoreHash: true })))
        .requests,
    ).toHaveLength(4);
  });
});

describe('AgentHandoffProvider', () => {
  it('writes a self-contained request, then uses the answer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gamex-handoff-'));
    const provider = new AgentHandoffProvider(dir);
    const pending = await runExtraction(CHUNKS, provider).catch((e: unknown) => e);
    expect(pending).toBeInstanceOf(HandoffPending);
    expect((pending as HandoffPending).pending).toEqual(['inventory#1']);
    const request = JSON.parse(
      readFileSync(join(dir, 'requests', 'inventory-1.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(request).toMatchObject({ id: 'inventory#1', answerAt: 'responses/inventory-1.json' });
    expect(request['responseSchema']).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['meta', 'constants']) as unknown,
    });
    expect(existsSync(join(dir, 'README.md'))).toBe(true);

    const outputs = tinyOutputs();
    for (const pass of ['inventory', 'flow', 'monetization', 'gaps'] as const) {
      writeFileSync(join(dir, 'responses', `${pass}-1.json`), JSON.stringify(outputs[pass][0]));
      const result = await runExtraction(CHUNKS, provider).catch((e: unknown) => e);
      if (pass !== 'gaps') expect(result, pass).toBeInstanceOf(HandoffPending);
      else expect(result).toMatchObject({ provider: 'agent' });
    }

    writeFileSync(join(dir, 'responses', 'flow-1.json'), '{"oops": true}');
    await expect(runExtraction(CHUNKS, provider)).rejects.toThrow(
      /responses\/flow-1\.json failed validation/,
    );
  });
});

describe('AnthropicProvider', () => {
  const request: LlmRequest = {
    id: 'gaps#1',
    pass: 'gaps',
    batch: 1,
    system: 'sys',
    documents: '<documents/>',
    instructions: 'do it',
    hash: 'h',
    attempt: 0,
  };

  function fakeClient(message: Record<string, unknown>, seen: unknown[]): Anthropic {
    return {
      beta: {
        messages: {
          stream: (params: unknown) => {
            seen.push(params);
            return { finalMessage: () => Promise.resolve(message) };
          },
        },
      },
    } as unknown as Anthropic;
  }

  const ok = {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    stop_details: null,
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: '{"gaps": []}' },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 7,
      cache_read_input_tokens: 90,
      cache_creation_input_tokens: null,
    },
  };

  it('sends structured output, caching, effort and server-side fallbacks', async () => {
    const seen: unknown[] = [];
    const provider = new AnthropicProvider({
      model: 'claude-opus-5-5',
      client: fakeClient(ok, seen),
    });
    const { GapsSchema } = await import('@gamex/extract');
    const res = await provider.complete(
      { ...request, attempt: 1, feedback: { previous: '{}', errors: '- at /gaps: missing' } },
      GapsSchema,
    );
    expect(res).toEqual({
      text: '{"gaps": []}',
      model: 'claude-opus-5-5',
      usage: { inputTokens: 100, outputTokens: 7, cacheReadTokens: 90, cacheWriteTokens: 0 },
    });
    expect(seen[0]).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema' } },
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '<documents/>', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'do it' },
          ],
        },
        { role: 'assistant', content: '{}' },
        { role: 'user', content: expect.stringContaining('- at /gaps: missing') as unknown },
      ],
    });
    const plain: unknown[] = [];
    await new AnthropicProvider({
      model: 'm',
      client: fakeClient(ok, plain),
      serverFallbacks: false,
      effort: 'max',
    }).complete(request, GapsSchema);
    expect(plain[0]).not.toHaveProperty('fallbacks');
    expect(plain[0]).toMatchObject({ output_config: { effort: 'max' } });
  });

  it('turns refusals and truncation into LlmError', async () => {
    const { GapsSchema } = await import('@gamex/extract');
    const refusal = new AnthropicProvider({
      model: 'm',
      client: fakeClient(
        { ...ok, stop_reason: 'refusal', stop_details: { category: 'cyber' } },
        [],
      ),
    });
    await expect(refusal.complete(request, GapsSchema)).rejects.toThrow(
      /declined request gaps#1 \(category: cyber\)/,
    );
    const cut = new AnthropicProvider({
      model: 'm',
      client: fakeClient({ ...ok, stop_reason: 'max_tokens' }, []),
    });
    await expect(cut.complete(request, GapsSchema)).rejects.toBeInstanceOf(LlmError);
    const failing = {
      beta: {
        messages: {
          stream: () => ({ finalMessage: () => Promise.reject(new Error('socket hang up')) }),
        },
      },
    } as unknown as Anthropic;
    await expect(
      new AnthropicProvider({ model: 'm', client: failing }).complete(request, GapsSchema),
    ).rejects.toMatchObject({
      name: 'LlmError',
      retryable: true,
      message: expect.stringContaining('socket hang up') as unknown,
    });
  });
});

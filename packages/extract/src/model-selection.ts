/**
 * LLM model selection (ADR 0002 §10): the user chooses the model their sessions use.
 * Resolution order: CLI `--model` flag → `GAMEX_MODEL` env var → `gamex/config.json` → default.
 */

export const DEFAULT_MODEL = 'claude-opus-5-5';

export interface ModelSources {
  readonly flag?: string | undefined;
  readonly env?: string | undefined;
  readonly config?: string | undefined;
}

export interface ResolvedModel {
  readonly model: string;
  readonly source: 'flag' | 'env' | 'config' | 'default';
}

export function resolveModel(sources: ModelSources): ResolvedModel {
  const candidates = [
    ['flag', sources.flag],
    ['env', sources.env],
    ['config', sources.config],
  ] as const;
  for (const [source, value] of candidates) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return { model: trimmed, source };
  }
  return { model: DEFAULT_MODEL, source: 'default' };
}
